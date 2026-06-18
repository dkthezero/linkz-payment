import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchMyReservations, cancelReservation } from './api';
import { ApiError } from '../common/api';

const token = 'token-abc';
const getToken = () => Promise.resolve(token);

const res = (overrides: Partial<Response> = {}): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve(null), ...overrides } as never as Response);

describe('fetchMyReservations', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('GETs /reservations with a Bearer token and parses the array', async () => {
    const body = [
      {
        id: '550e8400-e29b-41d4-a716-446655440002',
        seatIds: ['550e8400-e29b-41d4-a716-446655440010'],
        status: 'held',
        expiresAt: '2026-06-19T12:00:00.000Z',
      },
    ];
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(res({ json: () => Promise.resolve(body) }));
    const out = await fetchMyReservations(getToken);
    expect(spy).toHaveBeenCalledWith('/api/reservations', expect.objectContaining({ method: 'GET' }));
    const headers = (spy.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${token}`);
    expect(out).toEqual(body);
  });

  it('rejects malformed payloads', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(res({ json: () => Promise.resolve([{ id: 'bad' }]) }));
    await expect(fetchMyReservations(getToken)).rejects.toThrow();
  });
});

describe('cancelReservation', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('DELETEs /reservations/:id and resolves void on 204', async () => {
    const id = '550e8400-e29b-41d4-a716-446655440002';
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(res({ status: 204, ok: true }));
    await expect(cancelReservation(id, getToken)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(`/api/reservations/${id}`, expect.objectContaining({ method: 'DELETE' }));
  });

  it('throws ApiError on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      res({ ok: false, status: 409, json: () => Promise.resolve(null) }),
    );
    await expect(cancelReservation('r', getToken)).rejects.toBeInstanceOf(ApiError);
  });
});