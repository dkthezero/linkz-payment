import { describe, it, expect } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { TestCleanupController } from './test-cleanup.controller';

const makeController = (nodeEnv: string, bypassAuth: boolean): TestCleanupController => {
  const drizzle = {
    db: {
      execute: () => Promise.resolve(),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    },
  } as unknown;
  const config = {
    get: (key: string) => (key === 'NODE_ENV' ? nodeEnv : key === 'CLERK_BYPASS_AUTH' ? bypassAuth : undefined),
  } as unknown;
  return new TestCleanupController(drizzle as never, config as never);
};

describe('TestCleanupController in-handler gate', () => {
  it('throws in production', async () => {
    await expect(makeController('production', true).cleanup()).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
  it('throws when bypassAuth is false', async () => {
    await expect(makeController('development', false).cleanup()).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
  it('runs the truncate in non-production with bypassAuth true', async () => {
    await expect(makeController('test', true).cleanup()).resolves.toEqual({ cleaned: true });
  });
  it('expires a reservation in non-production bypass mode', async () => {
    await expect(makeController('test', true).expireReservation('any-id')).resolves.toEqual({
      expired: true,
    });
  });
  it('rejects expire-reservation in production', async () => {
    await expect(makeController('production', true).expireReservation('any-id')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
  it('releases a reservation in non-production bypass mode', async () => {
    await expect(makeController('test', true).releaseReservation('any-id')).resolves.toEqual({
      released: true,
    });
  });
  it('rejects release-reservation in production', async () => {
    await expect(makeController('production', true).releaseReservation('any-id')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});