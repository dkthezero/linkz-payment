import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, users, seats, reservations, payments } from '@linkz/database';
import type { DrizzleService } from '../../drizzle/drizzle.service';
import { DrizzlePaymentsRepository } from './drizzle.payments.repository';
import type { ProviderEvent } from '../payments.ports';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip; // integration: needs Postgres on 18602

class Rollback extends Error {}

d('DrizzlePaymentsRepository (integration, tx-rollback)', () => {
  const { db, client } = createDb(url as string);
  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  it('insertPending then settle: marks succeeded, idempotent on duplicate event', async () => {
    const u = `ext_${Date.now()}`;
    await db
      .transaction(async (tx) => {
        const [user] = await tx.insert(users).values({ externalId: u, email: `${u}@t.co`, name: 'Test User' }).returning();
        const [seat] = await tx.insert(seats).values({ label: `L_${u}` }).returning();
        const [res] = await tx
          .insert(reservations)
          .values({ seatId: seat.id, userId: user.id, status: 'held', sagaStep: 'createPayment' })
          .returning();

        const repo = new DrizzlePaymentsRepository({ db: tx } as unknown as DrizzleService);
        const pay = await repo.insertPending({
          reservationId: res.id,
          provider: 'stripe',
          providerRef: null,
          idempotencyKey: `pay_${res.id}`,
          amount: 5000,
          currency: 'usd',
          status: 'pending',
        });
        expect(pay.status).toBe('pending');

        const found = await repo.findByReservation(res.id);
        expect(found?.id).toBe(pay.id);

        const event: ProviderEvent = {
          id: `evt_${u}`,
          type: 'checkout.session.completed',
          paymentId: pay.id,
          isPaid: true,
          raw: {},
        };
        await repo.settle(pay.id, 'succeeded', event);

        const [after] = await tx.select().from(payments).where(eq(payments.id, pay.id));
        expect(after.status).toBe('succeeded');

        // same event again -> deduped, settle returns false
        const second = await repo.settle(pay.id, 'succeeded', event);
        expect(second).toBe(false);

        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });

  it('updateProviderRef sets provider_ref on the payment row', async () => {
    const u = `ext_${Date.now()}`;
    await db
      .transaction(async (tx) => {
        const [user] = await tx.insert(users).values({ externalId: u, email: `${u}@t.co`, name: 'Test User' }).returning();
        const [seat] = await tx.insert(seats).values({ label: `L_${u}` }).returning();
        const [res] = await tx
          .insert(reservations)
          .values({ seatId: seat.id, userId: user.id, status: 'held', sagaStep: 'createPayment' })
          .returning();

        const repo = new DrizzlePaymentsRepository({ db: tx } as unknown as DrizzleService);
        const pay = await repo.insertPending({
          reservationId: res.id,
          provider: 'stripe',
          providerRef: null,
          idempotencyKey: `pay_${res.id}`,
          amount: 5000,
          currency: 'usd',
          status: 'pending',
        });
        expect(pay.providerRef).toBeNull();

        await repo.updateProviderRef(pay.id, 'cs_ref_123');

        const [after] = await tx.select().from(payments).where(eq(payments.id, pay.id));
        expect(after.providerRef).toBe('cs_ref_123');

        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });

  it('findByReservation returns the latest attempt (ordered by createdAt desc)', async () => {
    const u = `ext_${Date.now()}`;
    await db
      .transaction(async (tx) => {
        const [user] = await tx.insert(users).values({ externalId: u, email: `${u}@t.co`, name: 'Test User' }).returning();
        const [seat] = await tx.insert(seats).values({ label: `L_${u}` }).returning();
        const [res] = await tx
          .insert(reservations)
          .values({ seatId: seat.id, userId: user.id, status: 'held', sagaStep: 'createPayment' })
          .returning();

        const repo = new DrizzlePaymentsRepository({ db: tx } as unknown as DrizzleService);
        // NOTE: payments.created_at defaults to CURRENT_TIMESTAMP, which Postgres
        // freezes at the START of a transaction — so two inserts in the same tx
        // get the same timestamp and ORDER BY created_at DESC is non-deterministic.
        // In production each attempt is its own transaction (separate requests), so
        // timestamps differ. Here we set explicit createdAt values to model that.
        const older = new Date('2026-01-01T00:00:00Z');
        const newer = new Date('2026-01-02T00:00:00Z');
        const [first] = await tx.insert(payments).values({
          reservationId: res.id,
          provider: 'stripe',
          providerRef: null,
          idempotencyKey: `pay_${res.id}_1`,
          amount: 5000,
          currency: 'usd',
          status: 'failed',
          createdAt: older,
          updatedAt: older,
        }).returning();
        const [second] = await tx.insert(payments).values({
          reservationId: res.id,
          provider: 'stripe',
          providerRef: null,
          idempotencyKey: `pay_${res.id}_2`,
          amount: 5000,
          currency: 'usd',
          status: 'pending',
          createdAt: newer,
          updatedAt: newer,
        }).returning();

        const found = await repo.findByReservation(res.id);
        expect(found?.id).toBe(second.id);
        expect(first.id).not.toBe(second.id);

        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });
});
