/**
 * Carries the "change seats" intent from the checkout page to the seat map.
 *
 * Both the "Change seats" button and the browser Back button (via a popstate
 * listener in CheckoutPage) write a pending-release record before leaving
 * checkout. On mount, the seat map consumes it: it releases the reservation
 * (DELETE /reservations/:id) and re-selects the seats that are still available,
 * dropping any taken in the meantime. sessionStorage survives the same-tab SPA
 * navigation but is cleared when the tab closes, so a stale intent never
 * outlives the session. Mirrors the narrowing style of `seats/selection.ts`.
 */
export const PENDING_RELEASE_STORAGE_KEY = 'linkz:pending-release';

export interface PendingRelease {
  reservationId: string;
  seatIds: string[];
}

/** Persist the change-seats intent. No-ops if storage is unavailable. */
export function setPendingRelease(payload: PendingRelease): void {
  try {
    sessionStorage.setItem(PENDING_RELEASE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* sessionStorage unavailable — intent just won't carry */
  }
}

/**
 * Read and clear the pending intent. Always clears the entry (even on a bad
 * payload) so a malformed intent never repeats. Returns null if absent or
 * malformed.
 */
export function consumePendingRelease(): PendingRelease | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(PENDING_RELEASE_STORAGE_KEY);
    if (raw !== null) sessionStorage.removeItem(PENDING_RELEASE_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const p = parsed as { reservationId?: unknown; seatIds?: unknown };
    if (typeof p.reservationId !== 'string') return null;
    if (!Array.isArray(p.seatIds)) return null;
    const seatIds = p.seatIds.filter((x): x is string => typeof x === 'string');
    return { reservationId: p.reservationId, seatIds };
  } catch {
    return null;
  }
}

/** Drop the pending intent without reading it. */
export function clearPendingRelease(): void {
  try {
    sessionStorage.removeItem(PENDING_RELEASE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}