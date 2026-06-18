import { pgTable, uuid, varchar, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users';

// Hold / booking + saga orchestration state.
// A reservation can cover multiple seats; the seat-level concurrency guard
// lives in `reservation_seats` (partial-unique on seat_id where active).
export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: varchar('status', { enum: ['held', 'confirmed', 'released', 'expired', 'refunded'] }).notNull(),
    sagaStep: varchar('saga_step').notNull(), // orchestration state
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }), // TTL for held seats (nullable)
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Sweep expired holds: status + hold_expires_at.
    index('ix_reservation_sweep').on(t.status, t.holdExpiresAt),
  ],
);
