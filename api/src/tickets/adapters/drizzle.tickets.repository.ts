import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { tickets } from '@linkz/database';
import { DrizzleService } from '../../drizzle/drizzle.service';
import type { TicketsRepository, TicketRow, NewTicket } from '../tickets.ports';

@Injectable()
export class DrizzleTicketsRepository implements TicketsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async insert(input: NewTicket): Promise<TicketRow> {
    const [row] = await this.drizzle.db
      .insert(tickets)
      .values({
        reservationId: input.reservationId,
        seatId: input.seatId,
        serial: input.serial,
        qrCode: input.qrCode,
      })
      .returning();
    return toRow(row);
  }

  async findByReservationId(reservationId: string): Promise<TicketRow[]> {
    const rows = await this.drizzle.db.select().from(tickets).where(eq(tickets.reservationId, reservationId));
    return rows.map(toRow);
  }
}

function toRow(row: typeof tickets.$inferSelect): TicketRow {
  return {
    id: row.id,
    reservationId: row.reservationId,
    seatId: row.seatId,
    serial: row.serial,
    qrCode: row.qrCode,
    issuedAt: row.issuedAt,
  };
}
