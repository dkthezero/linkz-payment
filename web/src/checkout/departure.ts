import type { CheckoutReviewResponse } from '@linkz/shared';
import type { PendingRelease } from '../reservations/pending-release';

/**
 * Build the change-seats intent from a loaded checkout review. The "Change
 * seats" button and the browser-Back popstate listener both call this before
 * leaving checkout so the seat map can release the reservation and re-select
 * the surviving seats.
 */
export function toPendingRelease(review: CheckoutReviewResponse): PendingRelease {
  return {
    reservationId: review.reservation.id,
    seatIds: review.seats.map((s) => s.id),
  };
}