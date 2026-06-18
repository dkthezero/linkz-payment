import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';

// Identity mirror — no password column (auth is delegated to Clerk).
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalId: varchar('external_id').notNull().unique(), // Clerk subject (sub)
  email: varchar('email').notNull(),
  name: varchar('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
