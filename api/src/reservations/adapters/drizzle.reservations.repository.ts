import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { reservations, reservationSeats, seats } from '@linkz/database';
import { DrizzleService } from '../../drizzle/drizzle.service';
import type { ReservationRow, NewReservation, ReservationsRepository, ReservationWithSeats } from '../reservations.ports';

const toRow = (row: typeof reservations.$inferSelect): ReservationRow => ({
  id: row.id,
  userId: row.userId,
  status: row.status,
  sagaStep: row.sagaStep,
  holdExpiresAt: row.holdExpiresAt,
  version: row.version,
  createdAt: row.createdAt,
});

@Injectable()
export class DrizzleReservationsRepository implements ReservationsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async insert(input: NewReservation, seatIds: string[]): Promise<ReservationRow> {
    return this.drizzle.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(reservations)
        .values({
          userId: input.userId,
          status: input.status,
          sagaStep: input.sagaStep,
          holdExpiresAt: input.holdExpiresAt,
        })
        .returning();

      if (seatIds.length > 0) {
        await tx.insert(reservationSeats).values(
          seatIds.map((seatId) => ({
            reservationId: row.id,
            seatId,
            status: input.status,
          })),
        );
      }

      return toRow(row);
    });
  }

  async findById(id: string): Promise<ReservationRow | null> {
    const [row] = await this.drizzle.db.select().from(reservations).where(eq(reservations.id, id));
    return row ? toRow(row) : null;
  }

  async findWithSeats(id: string): Promise<ReservationWithSeats | null> {
    const rows = await this.drizzle.db
      .select({ reservation: reservations, seat: seats })
      .from(reservations)
      .innerJoin(reservationSeats, eq(reservationSeats.reservationId, reservations.id))
      .innerJoin(seats, eq(seats.id, reservationSeats.seatId))
      .where(eq(reservations.id, id));

    if (rows.length === 0) return null;
    const { reservation } = rows[0];
    return {
      reservation: toRow(reservation),
      seats: rows.map((r) => ({
        id: r.seat.id,
        label: r.seat.label,
        price: r.seat.price,
      })),
    };
  }

  async listByUser(userId: string): Promise<ReservationRow[]> {
    const rows = await this.drizzle.db.select().from(reservations).where(eq(reservations.userId, userId));
    return rows.map(toRow);
  }

  async findSeatIds(reservationId: string): Promise<string[]> {
    const rows = await this.drizzle.db
      .select({ seatId: reservationSeats.seatId })
      .from(reservationSeats)
      .where(eq(reservationSeats.reservationId, reservationId));
    return rows.map((r) => r.seatId);
  }

  async confirm(id: string): Promise<void> {
    await this.drizzle.db.transaction(async (tx) => {
      // Accept 'held' (normal path) or 'expired' (hold elapsed before the Stripe
      // webhook arrived — payment was captured so we must still confirm). If
      // already 'confirmed' treat as idempotent (duplicate webhook retry).
      const [row] = await tx
        .update(reservations)
        .set({ status: 'confirmed', sagaStep: 'confirmed', updatedAt: new Date() })
        .where(and(eq(reservations.id, id), or(eq(reservations.status, 'held'), eq(reservations.status, 'expired'))))
        .returning();
      if (!row) {
        const [existing] = await tx.select({ status: reservations.status }).from(reservations).where(eq(reservations.id, id));
        if (existing?.status !== 'confirmed') throw new NotFoundException(`Reservation ${id} not found or not confirmable`);
        return; // already confirmed — idempotent
      }

      await tx
        .update(reservationSeats)
        .set({ status: 'confirmed', updatedAt: new Date() })
        .where(and(eq(reservationSeats.reservationId, id), or(eq(reservationSeats.status, 'held'), eq(reservationSeats.status, 'expired'))));
    });
  }

  async release(id: string, version: number): Promise<boolean> {
    return this.drizzle.db.transaction(async (tx) => {
      const [row] = await tx
        .update(reservations)
        .set({ status: 'released', sagaStep: 'released', version: sql`${reservations.version} + 1`, updatedAt: new Date() })
        .where(and(eq(reservations.id, id), eq(reservations.version, version), eq(reservations.status, 'held')))
        .returning();
      if (!row) return false;

      await tx
        .update(reservationSeats)
        .set({ status: 'released', updatedAt: new Date() })
        .where(and(eq(reservationSeats.reservationId, id), eq(reservationSeats.status, 'held')));
      return true;
    });
  }

  /**
   * DEMO ONLY. Frees the partial-unique seat slots of any confirmed (paid)
   * `reservation_seats` rows for the given seats (confirmed → released), so a
   * seat a previous customer already paid for can be re-held for the demo
   * flow. The parent `reservations` row is left `confirmed` — only the seat
   * slot is released. In production this must not run: paid seats stay reserved
   * and the seat map renders them as booked. Held (other-user) conflicts are
   * untouched here, so they still trip the partial-unique index → 409.
   *
   * TODO(production): remove this call from `ReservationsService.hold` and
   * render confirmed seats as unavailable on the seat map instead.
   */
  async releaseConfirmedSeats(seatIds: string[]): Promise<void> {
    if (seatIds.length === 0) return;
    await this.drizzle.db
      .update(reservationSeats)
      .set({ status: 'released', updatedAt: new Date() })
      .where(and(inArray(reservationSeats.seatId, seatIds), eq(reservationSeats.status, 'confirmed')));
  }
}
