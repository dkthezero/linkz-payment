import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { reservations } from './reservations';
import { seats } from './seats';

// Dummy issuer — one ticket per seat in a confirmed reservation
// (forward-recovery after capture).
export const tickets = pgTable('tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  reservationId: uuid('reservation_id')
    .notNull()
    .references(() => reservations.id),
  seatId: uuid('seat_id')
    .notNull()
    .references(() => seats.id),
  serial: varchar('serial').notNull().unique(),
  qrCode: varchar('qr_code'),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
});
