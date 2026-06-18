import { Injectable } from '@nestjs/common';
import { eq, and, inArray, getTableColumns } from 'drizzle-orm';
import { seats, reservationSeats, reservations } from '@linkz/database';
import { DrizzleService } from '../../drizzle/drizzle.service';
import type { SeatsRepository, SeatWithStatus } from '../seats.ports';

const activeStatuses: Array<'held' | 'confirmed'> = ['held', 'confirmed'];

@Injectable()
export class DrizzleSeatsRepository implements SeatsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findAll(): Promise<SeatWithStatus[]> {
    const rows = await this.drizzle.db
      .select({
        ...getTableColumns(seats),
        reservationStatus: reservationSeats.status,
        holdExpiresAt: reservations.holdExpiresAt,
      })
      .from(seats)
      .leftJoin(
        reservationSeats,
        and(eq(reservationSeats.seatId, seats.id), inArray(reservationSeats.status, activeStatuses)),
      )
      .leftJoin(reservations, eq(reservations.id, reservationSeats.reservationId));
    return rows as SeatWithStatus[];
  }

  async findById(id: string): Promise<SeatWithStatus | undefined> {
    const rows = await this.drizzle.db
      .select({
        ...getTableColumns(seats),
        reservationStatus: reservationSeats.status,
        holdExpiresAt: reservations.holdExpiresAt,
      })
      .from(seats)
      .leftJoin(
        reservationSeats,
        and(eq(reservationSeats.seatId, seats.id), inArray(reservationSeats.status, activeStatuses)),
      )
      .leftJoin(reservations, eq(reservations.id, reservationSeats.reservationId))
      .where(eq(seats.id, id));
    return rows[0] as SeatWithStatus | undefined;
  }
}
