import { describe, it, expect, vi } from 'vitest';
import { DrizzleUserRepository } from './drizzle.user.repository';

// Mock Drizzle's chained query builder. `select().from().where()` -> Promise<rows[]>;
// `insert().values().onConflictDoNothing()` -> Promise<void>.
const makeMockDrizzle = (rows: any[]) => {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });
  return { db: { select, insert } as any, _insert: insert, _onConflict: onConflictDoNothing };
};

const row = { id: 'u-1', externalId: 'ext1', email: 'a@b.com', name: 'Alice' };

describe('DrizzleUserRepository', () => {
  it('findByExternalId returns AppUser when found', async () => {
    const m = makeMockDrizzle([row]);
    const repo = new DrizzleUserRepository(m as any);
    expect(await repo.findByExternalId('ext1')).toEqual(row);
  });
  it('findByExternalId returns undefined when not found', async () => {
    const m = makeMockDrizzle([]);
    expect(await new DrizzleUserRepository(m as any).findByExternalId('ext1')).toBeUndefined();
  });
  it('upsert inserts on-conflict-do-nothing then re-selects the row', async () => {
    const m = makeMockDrizzle([row]);
    const repo = new DrizzleUserRepository(m as any);
    const out = await repo.upsert('ext1', 'a@b.com', 'Alice');
    expect(out).toEqual(row);
    expect(m._insert).toHaveBeenCalled();
    expect(m._onConflict).toHaveBeenCalled();
  });
});