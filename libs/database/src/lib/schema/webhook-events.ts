import { pgTable, varchar, jsonb, timestamp } from 'drizzle-orm/pg-core';

// Idempotency ledger — process each provider event exactly once.
export const webhookEvents = pgTable('webhook_events', {
  eventId: varchar('event_id').primaryKey(), // provider event id
  type: varchar('type').notNull(),
  payload: jsonb('payload').notNull(),
  status: varchar('status', { enum: ['received', 'processed', 'failed'] }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});
