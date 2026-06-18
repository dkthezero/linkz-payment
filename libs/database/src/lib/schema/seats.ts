import { pgTable, uuid, varchar, timestamp, integer } from 'drizzle-orm/pg-core';

// The 3 bookable seats.
export const seats = pgTable('seats', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: varchar('label').notNull().unique(),
  price: integer('price').notNull().default(5000),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
