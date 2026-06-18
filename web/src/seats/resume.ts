import type { ReservationResponse } from '@linkz/shared';

/**
 * Pick the live held reservation to resume, if any. A "live" hold is status
 * 'held' with a future expiresAt — `listByUser` returns rows directly (no
 * read-time expiry mapping like the seats endpoint has), so an
 * expired-but-not-yet-swept held row is treated as not live here. If several
 * are live, the one with the latest expiry wins.
 */
export function findLiveHold(
  reservations: ReservationResponse[],
  now: Date,
): ReservationResponse | null {
  const live = reservations.filter(
    (row) => row.status === 'held' && row.expiresAt != null && new Date(row.expiresAt).getTime() > now.getTime(),
  );
  if (live.length === 0) return null;
  return live.reduce((latest, row) =>
    new Date(row.expiresAt as string).getTime() > new Date(latest.expiresAt as string).getTime() ? row : latest,
  );
}

/**
 * After releasing a reservation and refetching seats, keep only the selected
 * seats that are still `available` — the just-released ones should be; any taken
 * in a race (now held/confirmed) are dropped. Preserves input order.
 */
export function reconcileSelection(
  seatIds: string[],
  seats: ReadonlyArray<{ id: string; status: string }>,
): string[] {
  const available = new Set(seats.filter((s) => s.status === 'available').map((s) => s.id));
  return seatIds.filter((id) => available.has(id));
}