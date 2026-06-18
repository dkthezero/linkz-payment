/**
 * Persists the user's seat selection across the Clerk sign-in redirect.
 *
 * Google OAuth (and other redirect-based sign-in flows) navigate the tab away
 * to the IdP and back, which reloads the SPA and would otherwise wipe the
 * in-memory `selectedIds` signal. `sessionStorage` survives same-tab
 * navigations/reloads (so the selection is restored after sign-in) but is
 * scoped to this tab and cleared when it closes — we never want a stale
 * selection from a previous visit. The selection is cleared once it is consumed
 * by a reservation (see SeatMap `onProceed`).
 */
export const SELECTION_STORAGE_KEY = 'linkz:selected-seats';

/** Read the persisted seat selection. Always returns a valid string[]. */
export function loadSelection(): string[] {
  try {
    const raw = sessionStorage.getItem(SELECTION_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

/** Persist the seat selection (clears storage when empty). No-ops if storage is unavailable. */
export function saveSelection(ids: string[]): void {
  try {
    if (ids.length === 0) sessionStorage.removeItem(SELECTION_STORAGE_KEY);
    else sessionStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* sessionStorage unavailable (private mode / quota) — selection just won't persist */
  }
}

/** Drop the persisted selection (e.g. after it is consumed by a reservation). */
export function clearSelection(): void {
  try {
    sessionStorage.removeItem(SELECTION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}