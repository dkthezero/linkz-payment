import { Inject, Injectable, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppUser } from '@linkz/shared';
import {
  CheckoutReviewResponseSchema,
  CreateReservationResponseSchema,
  ReservationResponseSchema,
  type CheckoutReviewResponse,
  type CreateReservationResponse,
  type ReservationResponse,
} from '@linkz/shared';
import { RESERVATIONS_REPOSITORY, type NewReservation, type ReservationRow, type ReservationsRepository } from './reservations.ports';
import { SEATS_REPOSITORY, type SeatsRepository } from '../seats/seats.ports';
import { assertActiveHold, assertOwns } from './reservation.domain';
import { PricingService } from '../pricing/pricing.service';
import { HoldExpirySweeper } from '../hold-expiry/hold-expiry-sweeper';

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    @Inject(RESERVATIONS_REPOSITORY) private readonly repo: ReservationsRepository,
    @Inject(SEATS_REPOSITORY) private readonly seats: SeatsRepository,
    private readonly config: ConfigService,
    private readonly pricing: PricingService,
    private readonly sweeper: HoldExpirySweeper,
  ) {}

  async hold(seatIds: string[], user: AppUser): Promise<CreateReservationResponse> {
    this.logger.debug(`hold: user=${user.id} seats=${seatIds.join(',')}`);
    // Validate every requested seat exists before attempting the atomic hold.
    const uniqueSeatIds = [...new Set(seatIds)];
    const found = await Promise.all(uniqueSeatIds.map((id) => this.seats.findById(id)));
    const missing = uniqueSeatIds.filter((_, i) => !found[i]);
    if (missing.length > 0) {
      throw new NotFoundException(`Seat(s) not found: ${missing.join(', ')}`);
    }

    // Reap any holds whose TTL has elapsed so their partial-unique slots free up
    // before the atomic insert — otherwise an expired-held seat would still
    // trip the 23505 even though it shows as `available` on the seat map.
    await this.sweeper.sweepExpiredHolds();

    // DEMO ONLY: free the partial-unique slots of any *confirmed* (paid) seats
    // in this request so a seat a previous customer already paid for can be
    // re-held. Held (other-user) conflicts are left in place — they still trip
    // the partial-unique index below and surface as a 409, which is the
    // concurrency conflict we want to demonstrate.
    // TODO(production): drop this call; keep paid seats reserved and render
    // them as booked on the seat map instead.
    await this.repo.releaseConfirmedSeats(uniqueSeatIds);

    const ttlMinutes = this.config.get<number>('HOLD_TTL_MINUTES') ?? 3;
    const holdExpiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const input: NewReservation = {
      userId: user.id,
      status: 'held',
      sagaStep: 'createPayment',
      holdExpiresAt,
    };

    try {
      const row = await this.repo.insert(input, uniqueSeatIds);
      this.logger.debug(`hold created: reservation=${row.id} seats=${uniqueSeatIds.join(',')}`);
      return CreateReservationResponseSchema.parse({ reservationId: row.id });
    } catch (e) {
      // Partial-unique index violation means one of the seats is already actively held/confirmed.
      if (isUniqueViolation(e)) {
        this.logger.debug(`hold conflict: seats=${uniqueSeatIds.join(',')}`);
        throw new ConflictException('One or more selected seats are no longer available');
      }
      throw e;
    }
  }

  async findById(id: string, userId: string): Promise<ReservationResponse> {
    const row = await this.repo.findById(id);
    assertOwns(row, userId);
    const seatIds = await this.repo.findSeatIds(id);
    return toResponse(row, seatIds);
  }

  async getCheckoutReview(reservationId: string, userId: string, email: string): Promise<CheckoutReviewResponse> {
    this.logger.debug(`checkout review: reservation=${reservationId} user=${userId}`);
    const joined = await this.repo.findWithSeats(reservationId);
    if (joined === null) throw new NotFoundException(`Reservation ${reservationId} not found`);
    assertOwns(joined.reservation, userId);
    assertActiveHold(joined.reservation, new Date());

    const seatList = joined.seats.map((seat) => ({
      id: seat.id,
      label: seat.label,
      descriptor: seatDescriptor(seat.label),
      price: seat.price,
    }));

    const pricing = this.pricing.compute(joined.seats.map((s) => s.price));

    return CheckoutReviewResponseSchema.parse({
      reservation: toResponse(joined.reservation, joined.seats.map((s) => s.id)),
      seats: seatList,
      pricing,
      contact: { email },
      status: joined.reservation.status,
    });
  }

  async release(reservationId: string, userId: string): Promise<void> {
    const row = await this.repo.findById(reservationId);
    assertOwns(row, userId);
    this.logger.debug(`release: reservation=${reservationId} user=${userId} version=${row.version}`);
    // row is non-null after assertOwns passes.
    const released = await this.repo.release(reservationId, row.version);
    if (!released) throw new ConflictException('Reservation no longer held');
    this.logger.debug(`released: reservation=${reservationId}`);
  }

  /**
   * System-driven compensation release. Used by the saga processor when a payment
   * fails (pre-capture compensation). Skips the ownership check because the
   * worker acts on behalf of the system, but still only transitions a 'held'
   * row so confirmed bookings are never accidentally released.
   */
  async releaseBySystem(reservationId: string): Promise<void> {
    const row = await this.repo.findById(reservationId);
    if (!row) throw new NotFoundException(`Reservation ${reservationId} not found`);
    if (row.status !== 'held') {
      throw new ConflictException(`Reservation is ${row.status}, cannot release`);
    }
    const released = await this.repo.release(reservationId, row.version);
    if (!released) throw new ConflictException('Reservation no longer held');
  }

  async listByUser(userId: string): Promise<ReservationResponse[]> {
    const rows = await this.repo.listByUser(userId);
    return Promise.all(
      rows.map(async (r) => {
        const seatIds = await this.repo.findSeatIds(r.id);
        return toResponse(r, seatIds);
      }),
    );
  }

  async confirm(id: string): Promise<ReservationResponse> {
    this.logger.debug(`confirm: reservation=${id}`);
    await this.repo.confirm(id);
    const row = await this.repo.findById(id);
    if (row === null) throw new NotFoundException(`Reservation ${id} not found`);
    const seatIds = await this.repo.findSeatIds(id);
    return toResponse(row, seatIds);
  }
}

function toResponse(row: ReservationRow, seatIds: string[]): ReservationResponse {
  return ReservationResponseSchema.parse({
    id: row.id,
    seatIds,
    status: row.status,
    expiresAt: row.holdExpiresAt?.toISOString() ?? null,
  });
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause !== 'object' || cause === null) return false;
  return (cause as { code?: unknown }).code === '23505';
}

function seatDescriptor(label: string): string {
  const row = label.match(/^([A-Z])/)?.[1] ?? '';
  if (!row) return 'Standard seat';
  if (row <= 'B') return 'Front row';
  if (row <= 'D') return 'Middle row';
  return 'Back row';
}
