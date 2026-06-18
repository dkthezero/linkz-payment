import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SeatResponseSchema, type SeatListResponse, type SeatResponse } from '@linkz/shared';
import { SEATS_REPOSITORY, type SeatWithStatus, type SeatsRepository } from './seats.ports';
import { isHoldExpired } from '../reservations/reservation.domain';
import { HoldExpirySweeper } from '../hold-expiry/hold-expiry-sweeper';

@Injectable()
export class SeatsService {
  private readonly logger = new Logger(SeatsService.name);

  constructor(
    @Inject(SEATS_REPOSITORY) private readonly repo: SeatsRepository,
    private readonly sweeper: HoldExpirySweeper,
  ) {}

  async findAll(): Promise<SeatListResponse> {
    const rows = await this.repo.findAll();
    const now = new Date();
    // Stable display order by seat label (natural/numeric-aware, so A2 < A10).
    // The frontend grid and the "Your selection" list both render in this order.
    const ordered = rows.slice().sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    const seats = ordered.map((row) => toSeatResponse(row, now));
    // Lazy reaping: if any held hold has elapsed, free its seat slot in the
    // background so the seat can be re-held. The response already shows the
    // seat as `available` via the read-time mapping above.
    if (rows.some((row) => isExpiredHold(row, now))) this.triggerSweep();
    return seats;
  }

  async findById(id: string): Promise<SeatResponse> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException(`Seat ${id} not found`);
    const now = new Date();
    const seat = toSeatResponse(row, now);
    if (isExpiredHold(row, now)) this.triggerSweep();
    return seat;
  }

  /** Fire-and-forget: free the partial-unique slots of expired-held seats. */
  private triggerSweep(): void {
    void this.sweeper.sweepExpiredHolds().catch((err) =>
      this.logger.warn(`hold-expiry sweep failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  }
}

/** A `held` row whose TTL has elapsed (null holdExpiresAt means "no expiry"). */
function isExpiredHold(row: SeatWithStatus, now: Date): boolean {
  return row.reservationStatus === 'held' && row.holdExpiresAt != null && isHoldExpired(row.holdExpiresAt, now);
}

function toSeatResponse(row: SeatWithStatus, now: Date): SeatResponse {
  const expired = isExpiredHold(row, now);
  const status: SeatResponse['status'] = expired || row.reservationStatus == null ? 'available' : row.reservationStatus;
  return SeatResponseSchema.parse({ id: row.id, label: row.label, price: row.price, status });
}