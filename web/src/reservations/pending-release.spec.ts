import { describe, it, expect, beforeEach } from 'vitest';
import {
  PENDING_RELEASE_STORAGE_KEY,
  setPendingRelease,
  consumePendingRelease,
  clearPendingRelease,
} from './pending-release';

const sample = {
  reservationId: '550e8400-e29b-41d4-a716-446655440002',
  seatIds: ['550e8400-e29b-41d4-a716-446655440010', '550e8400-e29b-41d4-a716-446655440011'],
};

describe('pending-release (sessionStorage)', () => {
  beforeEach(() => sessionStorage.clear());

  it('returns null when nothing is stored', () => {
    expect(consumePendingRelease()).toBeNull();
  });

  it('round-trips a payload through set/consume', () => {
    setPendingRelease(sample);
    expect(consumePendingRelease()).toEqual(sample);
  });

  it('consume clears the entry (second consume is null)', () => {
    setPendingRelease(sample);
    consumePendingRelease();
    expect(consumePendingRelease()).toBeNull();
    expect(sessionStorage.getItem(PENDING_RELEASE_STORAGE_KEY)).toBeNull();
  });

  it('clearPendingRelease removes the entry', () => {
    setPendingRelease(sample);
    clearPendingRelease();
    expect(consumePendingRelease()).toBeNull();
  });

  it('consume tolerates malformed JSON and clears it', () => {
    sessionStorage.setItem(PENDING_RELEASE_STORAGE_KEY, '{not json');
    expect(consumePendingRelease()).toBeNull();
    expect(sessionStorage.getItem(PENDING_RELEASE_STORAGE_KEY)).toBeNull();
  });

  it('consume rejects a non-object payload', () => {
    sessionStorage.setItem(PENDING_RELEASE_STORAGE_KEY, JSON.stringify('oops'));
    expect(consumePendingRelease()).toBeNull();
  });

  it('consume rejects a missing/non-string reservationId', () => {
    sessionStorage.setItem(PENDING_RELEASE_STORAGE_KEY, JSON.stringify({ seatIds: ['a'] }));
    expect(consumePendingRelease()).toBeNull();
  });

  it('consume rejects a non-array seatIds', () => {
    sessionStorage.setItem(PENDING_RELEASE_STORAGE_KEY, JSON.stringify({ reservationId: 'r1', seatIds: 'a' }));
    expect(consumePendingRelease()).toBeNull();
  });

  it('consume drops non-string seatIds', () => {
    sessionStorage.setItem(
      PENDING_RELEASE_STORAGE_KEY,
      JSON.stringify({ reservationId: 'r1', seatIds: ['a', 7, 'b', null] }),
    );
    expect(consumePendingRelease()).toEqual({ reservationId: 'r1', seatIds: ['a', 'b'] });
  });
});