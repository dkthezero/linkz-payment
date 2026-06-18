import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchPricing } from './api';
import { ApiError } from '../common/api';

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) } as never as Response);

describe('fetchPricing', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('parses a valid pricing response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      okResponse({ serviceFee: 400, currency: 'usd' }),
    );
    const out = await fetchPricing();
    expect(out).toEqual({ serviceFee: 400, currency: 'usd' });
  });

  it('rejects malformed payloads', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      okResponse({ serviceFee: 'x', currency: 'usd' }),
    );
    await expect(fetchPricing()).rejects.toThrow();
  });

  it('throws ApiError on non-ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve(null),
    } as never as Response);
    await expect(fetchPricing()).rejects.toBeInstanceOf(ApiError);
  });
});