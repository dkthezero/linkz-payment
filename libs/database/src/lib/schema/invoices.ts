import { pgTable, uuid, varchar, integer, timestamp } from 'drizzle-orm/pg-core';
import { reservations } from './reservations';

// Dummy issuer — idempotent per reservation (forward-recovery after capture).
export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  reservationId: uuid('reservation_id')
    .notNull()
    .unique()
    .references(() => reservations.id),
  number: varchar('number').notNull().unique(),
  amount: integer('amount').notNull(),
  currency: varchar('currency').notNull(),
  pdfUrl: varchar('pdf_url'),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
});
