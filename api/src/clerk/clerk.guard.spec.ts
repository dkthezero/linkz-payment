import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { ClerkGuard, decideBypass } from './clerk.guard';
import type { ClerkConfig } from './clerk.config';

vi.mock('@clerk/backend', () => ({ verifyToken: vi.fn() }));
import { verifyToken } from '@clerk/backend';
const mockedVerify = vi.mocked(verifyToken);

const realConfig: ClerkConfig = {
  secretKey: 'sk_test_x',
  authorizedParties: ['http://localhost:18601'],
  bypassAuth: false,
  bypassToken: '',
  bypassSubject: 'test_clerk_user',
  nodeEnv: 'test',
};

const bypassConfig = (overrides: Partial<ClerkConfig> = {}): ClerkConfig => ({
  ...realConfig,
  bypassAuth: true,
  bypassToken: 'tok-123',
  bypassSubject: 'test_clerk_user',
  nodeEnv: 'test',
  ...overrides,
});

const makeCtx = (authHeader?: string): ExecutionContext => {
  const req: Record<string, unknown> = { headers: {} };
  if (authHeader !== undefined) (req.headers as Record<string, unknown>).authorization = authHeader;
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
};

const reqUser = (ctx: ExecutionContext): unknown => {
  const req = ctx.switchToHttp().getRequest() as Record<string, unknown>;
  return req.user;
};

describe('decideBypass (pure)', () => {
  it('production never bypasses, even with bypassAuth=true', () => {
    expect(
      decideBypass({ nodeEnv: 'production', bypassAuth: true, bypassToken: 'tok', authHeader: 'Bearer tok' }),
    ).toBe('real');
  });
  it('bypassAuth=false falls through to real', () => {
    expect(
      decideBypass({ nodeEnv: 'test', bypassAuth: false, bypassToken: 'tok', authHeader: 'Bearer tok' }),
    ).toBe('real');
  });
  it('bypassAuth=true + empty configured token rejects', () => {
    expect(
      decideBypass({ nodeEnv: 'test', bypassAuth: true, bypassToken: '', authHeader: 'Bearer tok' }),
    ).toBe('reject');
  });
  it('bypassAuth=true + no Authorization header rejects', () => {
    expect(
      decideBypass({ nodeEnv: 'test', bypassAuth: true, bypassToken: 'tok', authHeader: undefined }),
    ).toBe('reject');
  });
  it('bypassAuth=true + wrong token rejects', () => {
    expect(
      decideBypass({ nodeEnv: 'test', bypassAuth: true, bypassToken: 'tok', authHeader: 'Bearer wrong' }),
    ).toBe('reject');
  });
  it('bypassAuth=true + matching Bearer token bypasses', () => {
    expect(
      decideBypass({ nodeEnv: 'test', bypassAuth: true, bypassToken: 'tok', authHeader: 'Bearer tok' }),
    ).toBe('bypass');
  });
});

describe('ClerkGuard bypass branch', () => {
  beforeEach(() => mockedVerify.mockClear());
  afterEach(() => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_JWT_KEY;
  });

  it('production + bypassAuth=true does NOT bypass (no req.user set, verify not reached without real token)', async () => {
    const guard = new ClerkGuard(bypassConfig({ nodeEnv: 'production' }));
    await expect(guard.canActivate(makeCtx('Bearer tok-123'))).rejects.toThrow(
      'Invalid or expired Clerk session token',
    );
  });

  it('test env + bypassAuth=true + correct Bearer token bypasses and sets req.user to subject', async () => {
    const ctx = makeCtx('Bearer tok-123');
    await expect(new ClerkGuard(bypassConfig()).canActivate(ctx)).resolves.toBe(true);
    expect(reqUser(ctx)).toBe('test_clerk_user');
    expect(mockedVerify).not.toHaveBeenCalled();
  });

  it('test env + bypassAuth=true + empty configured AUTH_BYPASS_TOKEN throws', async () => {
    await expect(new ClerkGuard(bypassConfig({ bypassToken: '' })).canActivate(makeCtx('Bearer tok-123'))).rejects.toThrow(
      'Invalid or missing bypass token',
    );
  });

  it('test env + bypassAuth=true + wrong token throws', async () => {
    await expect(new ClerkGuard(bypassConfig()).canActivate(makeCtx('Bearer wrong'))).rejects.toThrow(
      'Invalid or missing bypass token',
    );
  });

  it('test env + bypassAuth=false falls through to real path', async () => {
    mockedVerify.mockResolvedValueOnce({ sub: 'user_123', sid: 'sess_1' } as never);
    const ctx = makeCtx('Bearer valid.jwt');
    await expect(new ClerkGuard(realConfig).canActivate(ctx)).resolves.toBe(true);
    expect(reqUser(ctx)).toBe('user_123');
  });

  it('test env + bypassAuth=true + no Authorization header throws', async () => {
    await expect(new ClerkGuard(bypassConfig()).canActivate(makeCtx())).rejects.toThrow(
      'Invalid or missing bypass token',
    );
  });
});

describe('ClerkGuard real Clerk path', () => {
  beforeEach(() => mockedVerify.mockClear());
  afterEach(() => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_JWT_KEY;
  });

  it('rejects missing Authorization header', async () => {
    await expect(new ClerkGuard(realConfig).canActivate(makeCtx())).rejects.toThrow('Missing Bearer token');
  });
  it('rejects empty token', async () => {
    await expect(new ClerkGuard(realConfig).canActivate(makeCtx('Bearer '))).rejects.toThrow('Empty Bearer token');
  });
  it('sets req.user + clerkClaims + allows on valid token', async () => {
    mockedVerify.mockResolvedValueOnce({ sub: 'user_123', sid: 'sess_1' } as never);
    const ctx = makeCtx('Bearer valid.jwt');
    await expect(new ClerkGuard(realConfig).canActivate(ctx)).resolves.toBe(true);
    const req = ctx.switchToHttp().getRequest() as Record<string, unknown>;
    expect(req.user).toBe('user_123');
    expect(req.clerkClaims).toEqual({ sub: 'user_123', sid: 'sess_1' });
  });
  it('rejects when verifyToken throws', async () => {
    mockedVerify.mockRejectedValueOnce(new Error('bad'));
    await expect(new ClerkGuard(realConfig).canActivate(makeCtx('Bearer bad'))).rejects.toThrow(
      'Invalid or expired Clerk session token',
    );
  });
  it('uses the injected config, not process.env', async () => {
    process.env.CLERK_SECRET_KEY = 'WRONG_FROM_ENV';
    process.env.CLERK_JWT_KEY = 'WRONG_JWT';
    mockedVerify.mockResolvedValueOnce({ sub: 'user_123', sid: 'sess_1' } as never);
    await new ClerkGuard(realConfig).canActivate(makeCtx('Bearer valid.jwt'));
    expect(mockedVerify.mock.calls[0]?.[1]).toMatchObject({
      secretKey: 'sk_test_x',
      authorizedParties: ['http://localhost:18601'],
    });
    expect(mockedVerify.mock.calls[0]?.[1]).not.toMatchObject({ secretKey: 'WRONG_FROM_ENV' });
  });
});