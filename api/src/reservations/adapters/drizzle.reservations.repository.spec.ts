import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, users, seats, reservations, reservationSeats } from '@linkz/database';
import type { DrizzleService } from '../../drizzle/drizzle.service';
import { DrizzleReservationsRepository } from './drizzle.reservations.repository';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip; // integration: needs Postgres on 18602

class Rollback extends Error {}

d('DrizzleReservationsRepository (integration, tx-rollback)', () => {
  const { db, client } = createDb(url as string);

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  // Helper: seed a user + seats inside a tx and hand back their ids.
  const seed = async (tx: typeof db, seatCount = 1) => {
    const u = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const [user] = await tx
      .insert(users)
      .values({ externalId: u, email: `${u}@t.co`, name: 'Test User' })
      .returning();
    const createdSeats: Array<typeof seats.$inferSelect> = [];
    for (let i = 0; i < seatCount; i++) {
      const [seat] = await tx.insert(seats).values({ label: `L_${u}_${i}`, price: 1000 + i * 100 }).returning();
      createdSeats.push(seat);
    }
    return { user, seats: createdSeats };
  };

  it('inserts a held reservation for multiple seats and confirms it', async () => {
    const u = `ext_${Date.now()}`;
    await db
      .transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({ externalId: u, email: `${u}@t.co`, name: 'Test User' })
          .returning();
        const [s1] = await tx.insert(seats).values({ label: `L_${u}_1`, price: 1000 }).returning();
        const [s2] = await tx.insert(seats).values({ label: `L_${u}_2`, price: 1000 }).returning();

        const repo = new DrizzleReservationsRepository({ db: tx } as unknown as DrizzleService);
        const row = await repo.insert(
          {
            userId: user.id,
            status: 'held',
            sagaStep: 'createPayment',
            holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          },
          [s1.id, s2.id],
        );

        const found = await repo.findById(row.id);
        expect(found?.status).toBe('held');
        expect(found?.version).toBe(0);

        const linked = await tx.select().from(reservationSeats).where(eq(reservationSeats.reservationId, row.id));
        expect(linked.map((r) => r.seatId).sort()).toEqual([s1.id, s2.id].sort());

        await repo.confirm(row.id);
        const confirmed = await tx.select().from(reservations).where(eq(reservations.id, row.id));
        expect(confirmed[0].status).toBe('confirmed');
        const confirmedSeats = await tx
          .select()
          .from(reservationSeats)
          .where(eq(reservationSeats.reservationId, row.id));
        expect(confirmedSeats.every((s) => s.status === 'confirmed')).toBe(true);

        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });

  it('enforces at most one active reservation per seat', async () => {
    const u = `ext_${Date.now()}`;
    await db
      .transaction(async (tx) => {
        const { user, seats: seatRows } = await seed(tx, 1);
        const [seat] = seatRows;

        const repo = new DrizzleReservationsRepository({ db: tx } as unknown as DrizzleService);
        await repo.insert(
          {
            userId: user.id,
            status: 'held',
            sagaStep: 'createPayment',
            holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          },
          [seat.id],
        );

        await expect(
          repo.insert(
            {
              userId: user.id,
              status: 'held',
              sagaStep: 'createPayment',
              holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
            },
            [seat.id],
          ),
        ).rejects.toSatisfy((err: unknown) => (err as { cause?: { code?: string } }).cause?.code === '23505');

        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });

  it('release: correct version => true, status released, version bumped, seats released', async () => {
    await db
      .transaction(async (tx) => {
        const { user, seats: seatRows } = await seed(tx, 2);
        const repo = new DrizzleReservationsRepository({ db: tx } as unknown as DrizzleService);
        const row = await repo.insert(
          {
            userId: user.id,
            status: 'held',
            sagaStep: 'createPayment',
            holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          },
          seatRows.map((s) => s.id),
        );
        expect(row.version).toBe(0);

        const ok = await repo.release(row.id, row.version);
        expect(ok).toBe(true);
        const [after] = await tx.select().from(reservations).where(eq(reservations.id, row.id));
        expect(after.status).toBe('released');
        expect(after.version).toBe(1);
        const afterSeats = await tx
          .select()
          .from(reservationSeats)
          .where(eq(reservationSeats.reservationId, row.id));
        expect(afterSeats.every((s) => s.status === 'released')).toBe(true);

        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });

  it('release: stale version => false (no row updated)', async () => {
    await db
      .transaction(async (tx) => {
        const { user, seats: seatRows } = await seed(tx);
        const repo = new DrizzleReservationsRepository({ db: tx } as unknown as DrizzleService);
        const row = await repo.insert(
          {
            userId: user.id,
            status: 'held',
            sagaStep: 'createPayment',
            holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          },
          seatRows.map((s) => s.id),
        );

        const ok = await repo.release(row.id, row.version + 999); // wrong version
        expect(ok).toBe(false);
        const [after] = await tx.select().from(reservations).where(eq(reservations.id, row.id));
        expect(after.status).toBe('held'); // unchanged

        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });

  it('release: non-held (confirmed) => false', async () => {
    await db
      .transaction(async (tx) => {
        const { user, seats: seatRows } = await seed(tx);
        const repo = new DrizzleReservationsRepository({ db: tx } as unknown as DrizzleService);
        const row = await repo.insert(
          {
            userId: user.id,
            status: 'held',
            sagaStep: 'createPayment',
            holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          },
          seatRows.map((s) => s.id),
        );
        await repo.confirm(row.id); // held -> confirmed

        // confirm does not bump version, so row.version is still the original; but
        // status is now 'confirmed', so release's status='held' guard rejects it.
        const ok = await repo.release(row.id, row.version);
        expect(ok).toBe(false); // status is confirmed, not held => no row updated
        const [after] = await tx.select().from(reservations).where(eq(reservations.id, row.id));
        expect(after.status).toBe('confirmed');

        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });

  it('confirm: released row => no row updated (throws NotFound)', async () => {
    await db
      .transaction(async (tx) => {
        const { user, seats: seatRows } = await seed(tx);
        const repo = new DrizzleReservationsRepository({ db: tx } as unknown as DrizzleService);
        const row = await repo.insert(
          {
            userId: user.id,
            status: 'held',
            sagaStep: 'createPayment',
            holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          },
          seatRows.map((s) => s.id),
        );
        await repo.release(row.id, row.version); // held -> released

        await expect(repo.confirm(row.id)).rejects.toThrow(); // status='released' => zero rows => NotFound
        const [after] = await tx.select().from(reservations).where(eq(reservations.id, row.id));
        expect(after.status).toBe('released'); // still released, not confirmed

        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });

  it('listByUser: returns only the own rows', async () => {
    await db
      .transaction(async (tx) => {
        const { user, seats: seatRows } = await seed(tx);
        const other = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const [user2] = await tx
          .insert(users)
          .values({ externalId: other, email: `${other}@t.co`, name: 'Other' })
          .returning();
        const repo = new DrizzleReservationsRepository({ db: tx } as unknown as DrizzleService);
        await repo.insert(
          {
            userId: user.id,
            status: 'released',
            sagaStep: 'createPayment',
            holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          },
          seatRows.map((s) => s.id),
        );
        // user2 cannot hold the same seat (active-unique), so use a fresh seat.
        const seat2 = `L2_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const [s2] = await tx.insert(seats).values({ label: seat2, price: 500 }).returning();
        await repo.insert(
          {
            userId: user2.id,
            status: 'held',
            sagaStep: 'createPayment',
            holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          },
          [s2.id],
        );

        const mine = await repo.listByUser(user.id);
        expect(mine.every((r) => r.userId === user.id)).toBe(true);
        expect(mine.some((r) => r.userId === user2.id)).toBe(false);

        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });

  it('findWithSeats: returns all seat labels/prices for a reservation', async () => {
    await db
      .transaction(async (tx) => {
        const { user, seats: seatRows } = await seed(tx, 2);
        const repo = new DrizzleReservationsRepository({ db: tx } as unknown as DrizzleService);
        const row = await repo.insert(
          {
            userId: user.id,
            status: 'held',
            sagaStep: 'createPayment',
            holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          },
          seatRows.map((s) => s.id),
        );

        const joined = await repo.findWithSeats(row.id);
        expect(joined).not.toBeNull();
        expect(joined?.seats.map((s) => s.id).sort()).toEqual(seatRows.map((s) => s.id).sort());
        expect(joined?.seats.every((s) => s.label && typeof s.price === 'number')).toBe(true);
        expect(joined?.reservation.id).toBe(row.id);

        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });

  it('releaseConfirmedSeats: frees a paid (confirmed) seat so it can be re-held (demo)', async () => {
    await db
      .transaction(async (tx) => {
        const { user, seats: seatRows } = await seed(tx, 1);
        const [seat] = seatRows;
        const repo = new DrizzleReservationsRepository({ db: tx } as unknown as DrizzleService);

        // First customer holds + pays -> seat is confirmed and blocks re-hold.
        const row = await repo.insert(
          {
            userId: user.id,
            status: 'held',
            sagaStep: 'createPayment',
            holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          },
          [seat.id],
        );
        await repo.confirm(row.id);
        await expect(
          repo.insert(
            {
              userId: user.id,
              status: 'held',
              sagaStep: 'createPayment',
              holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
            },
            [seat.id],
          ),
        ).rejects.toSatisfy((err: unknown) => (err as { cause?: { code?: string } }).cause?.code === '23505');

        // Demo relaxation: free the confirmed slot, then the seat is re-holdable.
        await repo.releaseConfirmedSeats([seat.id]);
        const freedSeats = await tx
          .select()
          .from(reservationSeats)
          .where(eq(reservationSeats.seatId, seat.id));
        expect(freedSeats.some((s) => s.status === 'released')).toBe(true);
        expect(freedSeats.some((s) => s.status === 'confirmed')).toBe(false);

        await expect(
          repo.insert(
            {
              userId: user.id,
              status: 'held',
              sagaStep: 'createPayment',
              holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
            },
            [seat.id],
          ),
        ).resolves.toBeTruthy();

        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });
});
