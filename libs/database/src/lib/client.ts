import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type DbClient = ReturnType<typeof createDb>;

export function createDb(url: string) {
  const client = postgres(url);
  return { db: drizzle(client, { schema }), client };
}

let _instance: DbClient | undefined;
export function getDb(): DbClient {
  if (!_instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    _instance = createDb(url);
  }
  return _instance;
}