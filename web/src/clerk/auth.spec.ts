import { describe, it, expect, vi } from 'vitest';
import { deriveAuth, fetchMe } from './auth';

describe('deriveAuth', () => {
  it('signed-out when no session', () => {
    const a = deriveAuth({ isSignedIn: false, user: undefined, session: undefined } as any);
    expect(a.isSignedIn).toBe(false);
    expect(a.userId).toBeNull();
    expect(a.name).toBeNull();
    expect(a.getToken()).resolves.toBeNull();
  });
  it('signed-in with name from firstName/lastName', () => {
    const a = deriveAuth({ isSignedIn: true, user: { id: 'u1', firstName: 'Alice', lastName: 'Smith' }, session: { getToken: () => Promise.resolve('jwt') } } as any);
    expect(a.isSignedIn).toBe(true);
    expect(a.userId).toBe('u1');
    expect(a.name).toBe('Alice Smith');
    expect(a.getToken()).resolves.toBe('jwt');
  });
  it('signed-in name falls back to username', () => {
    const a = deriveAuth({ isSignedIn: true, user: { id: 'u1', firstName: '', lastName: '', username: 'alice' }, session: { getToken: () => Promise.resolve('jwt') } } as any);
    expect(a.name).toBe('alice');
  });
});

describe('fetchMe', () => {
  it('sends Bearer token + returns MeResponse', async () => {
    const body = { appUserId: 'u-1', clerkUserId: 'u1', email: 'a@b.com', name: 'Alice' };
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: () => Promise.resolve(body) } as any);
    const out = await fetchMe(() => Promise.resolve('jwt'));
    expect(out).toEqual(body);
    expect(spy).toHaveBeenCalledWith('/api/me', { headers: { Authorization: 'Bearer jwt' } });
  });
  it('throws when not authenticated', async () => {
    await expect(fetchMe(() => Promise.resolve(null))).rejects.toThrow('Not authenticated');
  });
  it('throws on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 401 } as any);
    await expect(fetchMe(() => Promise.resolve('jwt'))).rejects.toThrow('me request failed: 401');
  });
});