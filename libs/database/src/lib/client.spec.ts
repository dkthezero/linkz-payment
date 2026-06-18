import { describe, it, expect, vi } from 'vitest';

vi.mock('postgres', () => ({ default: vi.fn(() => vi.fn()) }));
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: vi.fn((c, opts: any) => ({ __db: true, client: c, opts })) }));

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createDb } from './client';

describe('createDb', () => {
  it('wires postgres + drizzle with schema', () => {
    const { db, client } = createDb('postgres://u:p@localhost:18602/linkz');
    expect(postgres).toHaveBeenCalledWith('postgres://u:p@localhost:18602/linkz');
    expect(drizzle).toHaveBeenCalledWith(client, expect.objectContaining({ schema: expect.any(Object) }));
    expect((db as any).__db).toBe(true);
  });
});

describe('getDb (lazy)', () => {
  it('throws when DATABASE_URL missing', async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();
    const { getDb } = await import('./client');
    expect(() => getDb()).toThrow('DATABASE_URL is not set');
  });
});