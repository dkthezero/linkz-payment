import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchSeats } from './api';
import { ApiError } from '../common/api';

describe('fetchSeats', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns parsed seats on success (public, no Authorization header)', async () => {
    const body = [
      { id: '550e8400-e29b-41d4-a716-446655440010', label: 'A1', price: 12000, status: 'available' },
      { id: '550e8400-e29b-41d4-a716-446655440011', label: 'A2', price: 9500, status: 'held' },
    ];
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(body),
    } as never as Response);
    const out = await fetchSeats();
    expect(spy).toHaveBeenCalledWith(
      '/api/seats',
      expect.objectContaining({ method: 'GET' }),
    );
    const headers = (spy.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
    expect(out).toEqual(body);
  });

  it('throws ApiError on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve(null),
    } as never as Response);
    await expect(fetchSeats()).rejects.toBeInstanceOf(ApiError);
  });

  it('rejects malformed payloads', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ id: 'bad' }]),
    } as never as Response);
    await expect(fetchSeats()).rejects.toThrow();
  });
});