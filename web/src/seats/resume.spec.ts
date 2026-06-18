import { describe, it, expect } from 'vitest';
import type { ReservationResponse } from '@linkz/shared';
import { findLiveHold, reconcileSelection } from './resume';

const now = new Date('2026-06-19T12:00:00.000Z');
const future = '2026-06-19T12:02:30.000Z';
const past = '2026-06-19T11:55:00.000Z';

const r = (over: Partial<ReservationResponse>): ReservationResponse => ({
  id: '550e8400-e29b-41d4-a716-446655440002',
  seatIds: ['550e8400-e29b-41d4-a716-446655440010'],
  status: 'held',
  expiresAt: future,
  ...over,
});

describe('findLiveHold', () => {
  it('returns null when there are no reservations', () => {
    expect(findLiveHold([], now)).toBeNull();
  });

  it('ignores released / confirmed / expired-status rows', () => {
    expect(findLiveHold([r({ status: 'released' })], now)).toBeNull();
    expect(findLiveHold([r({ status: 'confirmed' })], now)).toBeNull();
    expect(findLiveHold([r({ status: 'expired' })], now)).toBeNull();
  });

  it('ignores a held row whose TTL has elapsed (read-time expiry guard)', () => {
    expect(findLiveHold([r({ expiresAt: past })], now)).toBeNull();
  });

  it('ignores a held row with a null expiresAt', () => {
    expect(findLiveHold([r({ expiresAt: null })], now)).toBeNull();
  });

  it('returns the live held reservation', () => {
    const live = r({ id: '550e8400-e29b-41d4-a716-446655440009' });
    expect(findLiveHold([live], now)?.id).toBe(live.id);
  });

  it('picks the latest expiry among several live holds', () => {
    const a = r({ id: 'a', expiresAt: '2026-06-19T12:01:00.000Z' });
    const b = r({ id: 'b', expiresAt: '2026-06-19T12:03:00.000Z' });
    expect(findLiveHold([a, b], now)?.id).toBe('b');
  });
});

describe('reconcileSelection', () => {
  const seats = [
    { id: 's1', status: 'available' },
    { id: 's2', status: 'held' },
    { id: 's3', status: 'confirmed' },
  ];

  it('keeps only the selected seats that are available, in input order', () => {
    expect(reconcileSelection(['s1', 's2', 's3', 'sX'], seats)).toEqual(['s1']);
  });

  it('drops seats that are missing or unavailable', () => {
    expect(reconcileSelection(['s2', 's3', 'missing'], seats)).toEqual([]);
  });

  it('returns everything when all selected seats are available', () => {
    expect(reconcileSelection(['s1'], seats)).toEqual(['s1']);
  });
});