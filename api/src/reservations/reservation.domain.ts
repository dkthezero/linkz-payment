import { ConflictException, ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';

/**
 * Hold-expiry decision. A null holdExpiresAt means "no expiry" (e.g. confirmed
 * rows) and is never expired. Otherwise expired iff holdExpiresAt <= now.
 */
export function isHoldExpired(holdExpiresAt: Date | null, now: Date): boolean {
  if (holdExpiresAt === null) return false;
  return holdExpiresAt.getTime() <= now.getTime();
}

/**
 * Owner-gating. null row => NotFoundException (avoid enumeration of existence);
 * mismatched userId => ForbiddenException (spec: owner-gate, identity from
 * req.appUser.id). Declared as an `asserts` function so callers narrow `row`
 * to non-null after the call (call-site signature is unchanged for consumers).
 */
export function assertOwns(row: { userId: string } | null, userId: string): asserts row is { userId: string } {
  if (row === null) throw new NotFoundException('Reservation not found');
  if (row.userId !== userId) throw new ForbiddenException('Not allowed to access this reservation');
}

/**
 * Active-hold precondition for checkout review / release. status !== 'held'
 * => ConflictException; held but expired => GoneException('Hold expired').
 */
export function assertActiveHold(row: { status: string; holdExpiresAt: Date | null }, now: Date): void {
  if (row.status !== 'held') throw new ConflictException('Reservation is not held');
  if (isHoldExpired(row.holdExpiresAt, now)) throw new GoneException('Hold expired');
}