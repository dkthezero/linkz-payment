import { Injectable, Logger } from '@nestjs/common';
import { and, eq, lte, inArray, sql } from 'drizzle-orm';
import { reservations, reservationSeats } from '@linkz/database';
import { DrizzleService } from '../drizzle/drizzle.service';

/**
 * Reaps holds whose TTL has elapsed. Flips `reservations` rows past their
 * `hold_expires_at` (and still `status = 'held'`) to `expired`, and releases
 * the matching `reservation_seats` rows (`held` → `expired`) so the partial-unique
 * seat slot frees up and the seat can be re-held.
 *
 * Idempotent (every update is status-gated to `held`) and rides the
 * `ix_reservation_sweep` index (`status`, `hold_expires_at`). A null
 * `hold_expires_at` means "no expiry" and is never reaped, mirroring
 * `isHoldExpired` in `reservation.domain`. Triggered lazily from seat reads and
 * on hold (see ADR-002) — a background sweeper can be added later for promptness.
 */
@Injectable()
export class HoldExpirySweeper {
  private readonly logger = new Logger(HoldExpirySweeper.name);

  constructor(private readonly drizzle: DrizzleService) {}

  async sweepExpiredHolds(): Promise<string[]> {
    return this.drizzle.db.transaction(async (tx) => {
      const expired = await tx
        .update(reservations)
        .set({ status: 'expired', sagaStep: 'expired', version: sql`${reservations.version} + 1`, updatedAt: new Date() })
        .where(and(eq(reservations.status, 'held'), lte(reservations.holdExpiresAt, new Date())))
        .returning({ id: reservations.id });

      const ids = expired.map((r) => r.id);
      if (ids.length > 0) {
        await tx
          .update(reservationSeats)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(and(inArray(reservationSeats.reservationId, ids), eq(reservationSeats.status, 'held')));
        this.logger.debug(`swept ${ids.length} expired hold(s): ${ids.join(',')}`);
      }
      return ids;
    });
  }
}