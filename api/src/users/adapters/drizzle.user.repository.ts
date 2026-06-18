import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { users } from '@linkz/database';
import type { AppUser } from '@linkz/shared';
import { DrizzleService } from '../../drizzle/drizzle.service';
import type { UserRepository } from '../user.repository';

const toAppUser = (row: typeof users.$inferSelect): AppUser => ({
  id: row.id,
  externalId: row.externalId,
  email: row.email,
  name: row.name,
});

@Injectable()
export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findByExternalId(externalId: string): Promise<AppUser | undefined> {
    const rows = await this.drizzle.db.select().from(users).where(eq(users.externalId, externalId));
    const row = rows[0];
    return row ? toAppUser(row) : undefined;
  }

  async upsert(externalId: string, email: string, name: string): Promise<AppUser> {
    await this.drizzle.db
      .insert(users)
      .values({ externalId, email, name })
      .onConflictDoNothing({ target: users.externalId });
    const found = await this.findByExternalId(externalId);
    if (!found) throw new Error(`upsert failed for externalId=${externalId}`);
    return found;
  }
}