import { pgTable, uuid, varchar, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { reservations } from './reservations';
import { seats } from './seats';

// Join table linking a reservation to its seats.
// The partial-unique index enforces the core invariant: at most one *active*
// reservation per seat, regardless of how many seats a single reservation holds.
export const reservationSeats = pgTable(
  'reservation_seats',
  {
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id),
    seatId: uuid('seat_id')
      .notNull()
      .references(() => seats.id),
    status: varchar('status', { enum: ['held', 'confirmed', 'released', 'expired'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Seat-concurrency invariant: at most one *active* row per seat.
    uniqueIndex('uq_active_seat_partial')
      .on(t.seatId)
      .where(sql`${t.status} in ('held','confirmed')`),
  ],
);
