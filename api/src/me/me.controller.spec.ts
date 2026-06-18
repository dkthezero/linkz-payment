import { describe, it, expect } from 'vitest';
import { MeController } from './me.controller';

const appUser = { id: '550e8400-e29b-41d4-a716-446655440000', externalId: 'user_abc', email: 'a@b.com', name: 'Alice' };

describe('MeController', () => {
  it('returns appUserId + clerkUserId + email + name from req.appUser', () => {
    expect(new MeController().me({ user: 'user_abc', appUser } as any)).toEqual({
      appUserId: appUser.id,
      clerkUserId: 'user_abc',
      email: 'a@b.com',
      name: 'Alice',
    });
  });
  it('throws if appUser is missing', () => {
    expect(() => new MeController().me({ user: 'user_abc' } as any)).toThrow();
  });
});