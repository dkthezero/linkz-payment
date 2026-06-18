import { describe, it, expect, afterAll } from 'vitest';
import { createDb, users, seats, reservations, reservationSeats } from '@linkz/database';
import type { DrizzleService } from '../../drizzle/drizzle.service';
import { DrizzleSeatsRepository } from './drizzle.seats.repository';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip; // integration: needs Postgres on 18602

class Rollback extends Error {}

d('DrizzleSeatsRepository (integration, tx-rollback)', () => {
  const { db, client } = createDb(url as string);

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  it('returns all seats with available/held/confirmed status derived from active reservation_seats', async () => {
    const u = `ext_${Date.now()}`;
    await db
      .transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({ externalId: u, email: `${u}@t.co`, name: 'Test User' })
          .returning();
        const [seatAvailable] = await tx.insert(seats).values({ label: `AV_${u}`, price: 1000 }).returning();
        const [seatHeld] = await tx.insert(seats).values({ label: `HD_${u}`, price: 2000 }).returning();
        const [seatConfirmed] = await tx.insert(seats).values({ label: `CF_${u}`, price: 3000 }).returning();
        const [seatReleased] = await tx.insert(seats).values({ label: `RL_${u}`, price: 4000 }).returning();

        const holdReservation = async (
          seatId: string,
          status: 'held' | 'confirmed' | 'released',
          holdExpiresAt: Date | null = null,
        ) => {
          const [res] = await tx
            .insert(reservations)
            .values({ userId: user.id, status, sagaStep: status === 'held' ? 'holdSeat' : status, holdExpiresAt })
            .returning();
          await tx.insert(reservationSeats).values({ reservationId: res.id, seatId, status });
        };

        const [seatExpiredHeld] = await tx.insert(seats).values({ label: `EH_${u}`, price: 5000 }).returning();
        const pastExpiry = new Date(Date.now() - 10 * 60 * 1000);

        await holdReservation(seatHeld.id, 'held');
        await holdReservation(seatConfirmed.id, 'confirmed');
        await holdReservation(seatReleased.id, 'released');
        await holdReservation(seatExpiredHeld.id, 'held', pastExpiry);

        const repo = new DrizzleSeatsRepository({ db: tx } as unknown as DrizzleService);
        const all = await repo.findAll();
        const byId = (id: string) => all.find((s) => s.id === id);

        expect(byId(seatAvailable.id)?.reservationStatus).toBeNull();
        expect(byId(seatAvailable.id)?.holdExpiresAt).toBeNull();
        expect(byId(seatHeld.id)?.reservationStatus).toBe('held');
        expect(byId(seatHeld.id)?.holdExpiresAt).toBeNull(); // held with no TTL
        expect(byId(seatConfirmed.id)?.reservationStatus).toBe('confirmed');
        expect(byId(seatConfirmed.id)?.holdExpiresAt).toBeNull();
        expect(byId(seatReleased.id)?.reservationStatus).toBeNull();
        // The repo surfaces the raw held row + its holdExpiresAt; the SeatsService
        // is what maps an expired held row to 'available' at read time.
        expect(byId(seatExpiredHeld.id)?.reservationStatus).toBe('held');
        expect(byId(seatExpiredHeld.id)?.holdExpiresAt?.getTime()).toBe(pastExpiry.getTime());

        const found = await repo.findById(seatHeld.id);
        expect(found?.label).toBe(seatHeld.label);
        expect(found?.reservationStatus).toBe('held');

        const missing = await repo.findById('550e8400-e29b-41d4-a716-446655440099');
        expect(missing).toBeUndefined();

        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });
});
