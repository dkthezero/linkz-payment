import { describe, it, expect } from 'vitest';
import { ConflictException, ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';
import { assertActiveHold, assertOwns, isHoldExpired } from './reservation.domain';

const T = '2026-06-19T12:00:00Z';

describe('isHoldExpired', () => {
  it('null holdExpiresAt => false (no expiry)', () => {
    expect(isHoldExpired(null, new Date(T))).toBe(false);
  });
  it('future => false', () => {
    expect(isHoldExpired(new Date('2026-06-19T12:30:00Z'), new Date(T))).toBe(false);
  });
  it('past => true', () => {
    expect(isHoldExpired(new Date('2026-06-19T11:00:00Z'), new Date(T))).toBe(true);
  });
  it('exact => true (<= now)', () => {
    expect(isHoldExpired(new Date(T), new Date(T))).toBe(true);
  });
});

describe('assertOwns', () => {
  const owner = '550e8400-e29b-41d4-a716-446655440001';
  it('null row => NotFoundException', () => {
    expect(() => assertOwns(null, owner)).toThrow(NotFoundException);
  });
  it('matching userId => ok', () => {
    expect(() => assertOwns({ userId: owner }, owner)).not.toThrow();
  });
  it('mismatched userId => ForbiddenException', () => {
    expect(() => assertOwns({ userId: 'other' }, owner)).toThrow(ForbiddenException);
  });
});

describe('assertActiveHold', () => {
  it('held + future expiry => ok', () => {
    expect(() => assertActiveHold({ status: 'held', holdExpiresAt: new Date('2026-06-19T12:30:00Z') }, new Date(T))).not.toThrow();
  });
  it('held + expired => GoneException', () => {
    expect(() => assertActiveHold({ status: 'held', holdExpiresAt: new Date('2026-06-19T11:00:00Z') }, new Date(T))).toThrow(GoneException);
  });
  it('confirmed => ConflictException', () => {
    expect(() => assertActiveHold({ status: 'confirmed', holdExpiresAt: new Date('2026-06-19T12:30:00Z') }, new Date(T))).toThrow(ConflictException);
  });
  it('released => ConflictException', () => {
    expect(() => assertActiveHold({ status: 'released', holdExpiresAt: new Date('2026-06-19T12:30:00Z') }, new Date(T))).toThrow(ConflictException);
  });
});