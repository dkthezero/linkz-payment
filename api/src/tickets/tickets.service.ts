import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { TicketResponse } from '@linkz/shared';
import { RESERVATIONS_REPOSITORY, type ReservationsRepository } from '../reservations/reservations.ports';
import { TICKETS_REPOSITORY, type TicketsRepository, type NewTicket, type TicketRow } from './tickets.ports';

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    @Inject(TICKETS_REPOSITORY) private readonly repo: TicketsRepository,
    @Inject(RESERVATIONS_REPOSITORY) private readonly reservations: ReservationsRepository,
  ) {}

  async issue(reservationId: string): Promise<TicketResponse[]> {
    this.logger.debug(`issue tickets: reservation=${reservationId}`);
    const reservation = await this.reservations.findById(reservationId);
    if (!reservation) throw new NotFoundException(`Reservation ${reservationId} not found`);
    if (reservation.status !== 'confirmed') {
      throw new ConflictException(`Reservation is ${reservation.status}, tickets can only be issued after confirmation`);
    }

    const seatIds = await this.reservations.findSeatIds(reservationId);
    const existing = await this.repo.findByReservationId(reservationId);
    const existingBySeat = new Map(existing.map((t) => [t.seatId, t]));

    const issued: TicketResponse[] = [];
    for (const seatId of seatIds) {
      const ticket = existingBySeat.get(seatId);
      if (ticket) {
        issued.push(toResponse(ticket));
      } else {
        // Dummy data: deterministic serial + placeholder QR. The saga really
        // triggers ticket issuance; these values are placeholders so the
        // frontend can render the flow without a real QR/serial backend.
        const input: NewTicket = {
          reservationId,
          seatId,
          serial: `T-DUMMY-${reservationId.slice(0, 8)}-${seatId.slice(-12)}`,
          qrCode: 'DUMMY-QR',
        };
        const row = await this.repo.insert(input);
        issued.push(toResponse(row));
      }
    }
    this.logger.debug(`issued tickets: reservation=${reservationId} count=${issued.length}`);
    return issued;
  }

  async findByReservationId(reservationId: string): Promise<TicketResponse[]> {
    const rows = await this.repo.findByReservationId(reservationId);
    if (rows.length === 0) throw new NotFoundException(`Tickets for reservation ${reservationId} not found`);
    return rows.map(toResponse);
  }
}

function toResponse(row: TicketRow): TicketResponse {
  return {
    id: row.id,
    reservationId: row.reservationId,
    seatId: row.seatId,
    serial: row.serial,
    qrCode: row.qrCode,
  };
}
