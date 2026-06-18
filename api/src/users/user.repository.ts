import type { AppUser } from '@linkz/shared';

export interface UserRepository {
  findByExternalId(externalId: string): Promise<AppUser | undefined>;
  upsert(externalId: string, email: string, name: string): Promise<AppUser>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');