import { describe, it, expect, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { UserResolver } from './user.resolver';
import { ClerkUserNotFoundError } from '../clerk/clerk.backend';

const makeCtx = (user?: string): ExecutionContext => {
  const req: any = { user };
  return { switchToHttp: () => ({ getRequest: () => req }) } as any;
};
const appUser = { id: 'u-1', externalId: 'sub1', email: 'a@b.com', name: 'Alice' };
const config = { bypassAuth: false };
const makeResolver = (users: any, backend: any) => new UserResolver(users, backend, config as any);

describe('UserResolver', () => {
  it('attaches an existing user without a backend call', async () => {
    const users = { findByExternalId: vi.fn().mockResolvedValue(appUser), upsert: vi.fn() };
    const backend = { getUserProfile: vi.fn() };
    const ctx = makeCtx('sub1');
    await expect(makeResolver(users as any, backend as any).canActivate(ctx)).resolves.toBe(true);
    expect((ctx.switchToHttp().getRequest() as any).appUser).toEqual(appUser);
    expect(backend.getUserProfile).not.toHaveBeenCalled();
    expect(users.upsert).not.toHaveBeenCalled();
  });
  it('provisions a missing user: backend fetch + upsert + attach', async () => {
    const users = {
      findByExternalId: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(appUser),
      upsert: vi.fn().mockResolvedValue(appUser),
    };
    const backend = { getUserProfile: vi.fn().mockResolvedValue({ email: 'a@b.com', name: 'Alice' }) };
    const ctx = makeCtx('sub1');
    await makeResolver(users as any, backend as any).canActivate(ctx);
    expect(backend.getUserProfile).toHaveBeenCalledWith('sub1');
    expect(users.upsert).toHaveBeenCalledWith('sub1', 'a@b.com', 'Alice');
    expect((ctx.switchToHttp().getRequest() as any).appUser).toEqual(appUser);
  });
  it('provisions a test user in bypass mode without calling Clerk', async () => {
    const users = { findByExternalId: vi.fn().mockResolvedValue(undefined), upsert: vi.fn().mockResolvedValue(appUser) };
    const backend = { getUserProfile: vi.fn() };
    const ctx = makeCtx('sub1');
    await new UserResolver(users as any, backend as any, { bypassAuth: true } as any).canActivate(ctx);
    expect(backend.getUserProfile).not.toHaveBeenCalled();
    expect(users.upsert).toHaveBeenCalledWith('sub1', 'test@example.com', 'Test User');
    expect((ctx.switchToHttp().getRequest() as any).appUser).toEqual(appUser);
  });
  it('throws 401 (Unauthorized) when the Clerk user is gone (404)', async () => {
    const users = { findByExternalId: vi.fn().mockResolvedValue(undefined), upsert: vi.fn() };
    const backend = { getUserProfile: vi.fn().mockRejectedValue(new ClerkUserNotFoundError('sub1')) };
    await expect(makeResolver(users as any, backend as any).canActivate(makeCtx('sub1'))).rejects.toThrow(
      'Clerk user no longer exists',
    );
  });
  it('throws 503 (Service Unavailable) on backend outage', async () => {
    const users = { findByExternalId: vi.fn().mockResolvedValue(undefined), upsert: vi.fn() };
    const backend = { getUserProfile: vi.fn().mockRejectedValue(new Error('network down')) };
    await expect(makeResolver(users as any, backend as any).canActivate(makeCtx('sub1'))).rejects.toThrow(
      'Unable to provision user',
    );
  });
  it('throws when there is no verified subject (guard misconfiguration)', async () => {
    const users = { findByExternalId: vi.fn(), upsert: vi.fn() };
    const backend = { getUserProfile: vi.fn() };
    await expect(makeResolver(users as any, backend as any).canActivate(makeCtx(undefined))).rejects.toThrow();
  });
});