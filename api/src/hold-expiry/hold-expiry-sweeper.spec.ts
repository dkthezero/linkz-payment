import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, users, seats, reservations, reservationSeats } from '@linkz/database';
import type { DrizzleService } from '../drizzle/drizzle.service';
import { HoldExpirySweeper } from './hold-expiry-sweeper';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip; // integration: needs Postgres on 18602

class Rollback extends Error {}

d('HoldExpirySweeper (integration, tx-rollback)', () => {
  const { db, client } = createDb(url as string);

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  const seed = async (tx: typeof db) => {
    const u = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const [user] = await tx
      .insert(users)
      .values({ externalId: u, email: `${u}@t.co`, name: 'Test User' })
      .returning();
    const [seat] = await tx.insert(seats).values({ label: `L_${u}`, price: 1000 }).returning();
    return { user, seat };
  };

  const hold = async (tx: typeof db, userId: string, seatId: string, holdExpiresAt: Date | null) => {
    const [res] = await tx
      .insert(reservations)
      .values({ userId, status: 'held', sagaStep: 'createPayment', holdExpiresAt })
      .returning();
    await tx.insert(reservationSeats).values({ reservationId: res.id, seatId, status: 'held' });
    return res;
  };

  it('flips a held reservation past its TTL to expired and frees the seat slot', async () => {
    await db
      .transaction(async (tx) => {
        const { user, seat } = await seed(tx);
        const past = new Date(Date.now() - 10 * 60 * 1000);
        const res = await hold(tx, user.id, seat.id, past);

        const sweeper = new HoldExpirySweeper({ db: tx } as unknown as DrizzleService);
        // sweepExpiredHolds reaps *all* elapsed holds; on a shared dev DB it may
        // also reap pre-existing expired-held rows, so assert membership, not
        // exact equality.
        const ids = await sweeper.sweepExpiredHolds();
        expect(ids).toContain(res.id);

        const [after] = await tx.select().from(reservations).where(eq(reservations.id, res.id));
        expect(after.status).toBe('expired');
        expect(after.version).toBe(1);
        const seatRows = await tx.select().from(reservationSeats).where(eq(reservationSeats.reservationId, res.id));
        expect(seatRows.every((s) => s.status === 'expired')).toBe(true);

        // Partial-unique slot is free again: a fresh held reservation for the
        // same seat now succeeds (no 23505).
        const [res2] = await tx
          .insert(reservations)
          .values({ userId: user.id, status: 'held', sagaStep: 'createPayment', holdExpiresAt: new Date(Date.now() + 60_000) })
          .returning();
        await tx.insert(reservationSeats).values({ reservationId: res2.id, seatId: seat.id, status: 'held' });
        expect(res2.id).not.toBe(res.id);

        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });

  it('leaves a held reservation with future expiry untouched', async () => {
    await db
      .transaction(async (tx) => {
        const { user, seat } = await seed(tx);
        const future = new Date(Date.now() + 10 * 60 * 1000);
        const res = await hold(tx, user.id, seat.id, future);

        const sweeper = new HoldExpirySweeper({ db: tx } as unknown as DrizzleService);
        const ids = await sweeper.sweepExpiredHolds();
        expect(ids).not.toContain(res.id);

        const [after] = await tx.select().from(reservations).where(eq(reservations.id, res.id));
        expect(after.status).toBe('held');

        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });

  it('leaves a held reservation with null holdExpiresAt untouched (no expiry)', async () => {
    await db
      .transaction(async (tx) => {
        const { user, seat } = await seed(tx);
        const res = await hold(tx, user.id, seat.id, null);

        const sweeper = new HoldExpirySweeper({ db: tx } as unknown as DrizzleService);
        const ids = await sweeper.sweepExpiredHolds();
        expect(ids).not.toContain(res.id);

        const [after] = await tx.select().from(reservations).where(eq(reservations.id, res.id));
        expect(after.status).toBe('held');

        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });

  it('is idempotent: a second sweep reaps nothing', async () => {
    await db
      .transaction(async (tx) => {
        const { user, seat } = await seed(tx);
        const past = new Date(Date.now() - 10 * 60 * 1000);
        const res = await hold(tx, user.id, seat.id, past);

        const sweeper = new HoldExpirySweeper({ db: tx } as unknown as DrizzleService);
        await sweeper.sweepExpiredHolds();
        const second = await sweeper.sweepExpiredHolds();
        expect(second).toEqual([]);

        const [after] = await tx.select().from(reservations).where(eq(reservations.id, res.id));
        expect(after.status).toBe('expired'); // unchanged by the no-op second sweep

        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });
});