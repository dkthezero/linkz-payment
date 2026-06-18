import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiFetch, ApiError, loadWebEnv } from './api';

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) } as never as Response);

describe('apiFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('GET no token: calls fetch with base + path and JSON content-type, no Authorization', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({}));
    await apiFetch('/seats');
    expect(spy).toHaveBeenCalledWith(
      '/api/seats',
      expect.objectContaining({
        method: 'GET',
        headers: expect.not.objectContaining({ Authorization: expect.any(String) }),
      }),
    );
    expect(spy.mock.calls[0][1]?.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('GET with token: headers include Authorization Bearer', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({}));
    await apiFetch('/me', { getToken: () => Promise.resolve('t') });
    expect(spy).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({
        method: 'GET',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
      }),
    );
  });

  it('POST body: options carry method POST and JSON.stringify body', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({}));
    await apiFetch('/reservations', { method: 'POST', body: { seatIds: ['s1', 's2'] } });
    const [, init] = spy.mock.calls[0];
    expect(init).toMatchObject({ method: 'POST' });
    expect(init?.body).toBe(JSON.stringify({ seatIds: ['s1', 's2'] }));
  });

  it('non-ok: rejects with ApiError carrying status + body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ msg: 'x' }),
    } as never as Response);
    await expect(apiFetch('/x')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      body: { msg: 'x' },
    });
    await expect(apiFetch('/x')).rejects.toBeInstanceOf(ApiError);
  });

  it('base URL: defaults to /api when VITE_API_URL unset', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({}));
    await apiFetch('/pricing');
    expect(spy.mock.calls[0][0]).toBe('/api/pricing');
  });
});

describe('loadWebEnv', () => {
  // NOTE: loadWebEnv caches on success. Order matters — the throw case runs
  // first (before any success caches a value), then the success case caches.
  it('throws when VITE_CLERK_PUBLISHABLE_KEY is unset', () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', '');
    expect(() => loadWebEnv()).toThrow();
  });

  it('returns parsed env when VITE_CLERK_PUBLISHABLE_KEY is set', () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_x');
    const env = loadWebEnv();
    expect(env.VITE_CLERK_PUBLISHABLE_KEY).toBe('pk_test_x');
  });
});