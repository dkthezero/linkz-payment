import { pgTable, uuid, varchar, integer, timestamp } from 'drizzle-orm/pg-core';
import { reservations } from './reservations';

// Payment attempts.
export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  reservationId: uuid('reservation_id')
    .notNull()
    .references(() => reservations.id),
  provider: varchar('provider').notNull(),
  providerRef: varchar('provider_ref'), // PSP intent id (nullable until created)
  idempotencyKey: varchar('idempotency_key').notNull().unique(), // prevents double charge
  amount: integer('amount').notNull(),
  currency: varchar('currency').notNull(),
  status: varchar('status', { enum: ['pending', 'succeeded', 'failed', 'refunded'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
