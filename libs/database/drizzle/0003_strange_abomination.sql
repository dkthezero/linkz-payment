CREATE TABLE "reservation_seats" (
	"reservation_id" uuid NOT NULL,
	"seat_id" uuid NOT NULL,
	"status" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_reservation_id_unique";--> statement-breakpoint

-- Remove the old reservation-level seat foreign key and partial-unique index
-- before adding the new seat-level guard with the same index name.
ALTER TABLE "reservations" DROP CONSTRAINT "reservations_seat_id_seats_id_fk";
--> statement-breakpoint
DROP INDEX "uq_active_seat_partial";
--> statement-breakpoint

ALTER TABLE "reservation_seats" ADD CONSTRAINT "reservation_seats_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_seats" ADD CONSTRAINT "reservation_seats_seat_id_seats_id_fk" FOREIGN KEY ("seat_id") REFERENCES "public"."seats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Migrate existing 1-to-1 seat mapping into the new join table before dropping the old column.
INSERT INTO "reservation_seats" ("reservation_id", "seat_id", "status")
SELECT "id", "seat_id", "status"
FROM "reservations"
WHERE "seat_id" IS NOT NULL;

--> statement-breakpoint
CREATE UNIQUE INDEX "uq_active_seat_partial" ON "reservation_seats" USING btree ("seat_id") WHERE "reservation_seats"."status" in ('held','confirmed');--> statement-breakpoint
ALTER TABLE "reservations" DROP COLUMN "seat_id";
