# Change seats — resume on load + release/reselect on back Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a signed-in user has a live held reservation, the seat map resumes them to checkout on load; when they go back from checkout (browser Back or "Change seats"), the reservation is released and its seats are re-selected (keeping available ones, dropping taken ones).

**Architecture:** Pure web-side change reusing existing backend endpoints (`GET /reservations`, `DELETE /reservations/:id`). A `sessionStorage` "pending-release" flag carries the change-seats intent from checkout to the seat map. Pure decision functions (`findLiveHold`, `reconcileSelection`, `toPendingRelease`) are extracted and unit-tested; thin Solid components wire them with one-time `createEffect` entry logic and a `popstate` listener. No backend changes.

**Tech Stack:** SolidJS (`createSignal`/`createResource`/`createEffect`/`onCleanup`/`Show`/`For`/`createMemo`), `@solidjs/router` (`useNavigate`), Zod (`@linkz/shared` schemas), Vitest (jsdom), Nx (`pnpm nx run web:test`).

## Global Constraints

- Run everything through nx: `pnpm nx run web:test`, `pnpm nx run-many -t test lint build`. Never call vitest/eslint directly.
- TypeScript strict, no `any` (use `unknown` + narrow). Prefer union literals. Validate external input at boundaries (sessionStorage is a boundary — manual narrowing in the style of `apps/web/src/seats/selection.ts`).
- SolidJS: never destructure `props`; read `props.x`. Keep `createEffect` rare; prefer signals/memos. Render with `<Show>`/`<For>`.
- Secrets via env files only; never commit keys.
- Follow the existing web test pattern: extract logic into pure modules and unit-test those; there is no `solid-testing-library` component-render harness in this repo, so components are wired and verified by running the app + the automated test/lint/build gate.
- Conventions: thin components, logic in pure helpers; reach the API through the thin `../api/client` barrel.
- Atomic over the reservation id: Back/Change-seats releases the **whole** reservation. Held conflicts with other users remain (this plan does not touch `hold()` conflict semantics).

**Spec:** `docs/superpowers/specs/2026-06-19-change-seats-resume-and-reselect-design.md`

---

## File Structure

- **Create** `apps/web/src/reservations/pending-release.ts` — `sessionStorage` flag for the change-seats intent (`setPendingRelease` / `consumePendingRelease` / `clearPendingRelease` + `PendingRelease` type). Pure, no Solid.
- **Create** `apps/web/src/reservations/pending-release.spec.ts` — unit tests for the above.
- **Create** `apps/web/src/reservations/api.spec.ts` — unit tests for the two new API helpers.
- **Create** `apps/web/src/seats/resume.ts` — pure decision helpers `findLiveHold` and `reconcileSelection`.
- **Create** `apps/web/src/seats/resume.spec.ts` — unit tests for the above.
- **Create** `apps/web/src/checkout/departure.ts` — pure `toPendingRelease(review)` mapping.
- **Create** `apps/web/src/checkout/departure.spec.ts` — unit test.
- **Modify** `apps/web/src/reservations/api.ts` — add `fetchMyReservations` + `cancelReservation`.
- **Modify** `apps/web/src/api/client.ts` — re-export the two new helpers.
- **Modify** `apps/web/src/seats/SeatMap.tsx` — on-mount entry effect (consume pending-release → release + reselect + reconcile; else find live hold → resume to checkout; else normal).
- **Modify** `apps/web/src/checkout/CheckoutPage.tsx` — "Change seats" button + `popstate` listener that write the pending-release intent.

---

### Task 1: `pending-release.ts` — change-seats intent persistence

**Files:**
- Create: `apps/web/src/reservations/pending-release.ts`
- Test: `apps/web/src/reservations/pending-release.spec.ts`

**Interfaces:**
- Produces: `PENDING_RELEASE_STORAGE_KEY: string`, `PendingRelease { reservationId: string; seatIds: string[] }`, `setPendingRelease(payload: PendingRelease): void`, `consumePendingRelease(): PendingRelease | null`, `clearPendingRelease(): void`. `consumePendingRelease` reads AND clears the entry (so a stale intent never repeats).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/reservations/pending-release.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run web:test -- src/reservations/pending-release.spec.ts`
Expected: FAIL (module `./pending-release` not found / exports undefined).

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/reservations/pending-release.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run web:test -- src/reservations/pending-release.spec.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/reservations/pending-release.ts apps/web/src/reservations/pending-release.spec.ts
git commit -m "feat(web): pending-release sessionStorage helper for change-seats intent"
```

---

### Task 2: `fetchMyReservations` + `cancelReservation` API helpers

**Files:**
- Modify: `apps/web/src/reservations/api.ts`
- Modify: `apps/web/src/api/client.ts`
- Test: `apps/web/src/reservations/api.spec.ts`

**Interfaces:**
- Consumes: `apiFetch(path, opts?)` and `GetToken` from `../common/api`; `ReservationResponseSchema`, `ReservationResponse` from `@linkz/shared`.
- Produces: `fetchMyReservations(getToken: GetToken): Promise<ReservationResponse[]>` (GET `/reservations`); `cancelReservation(reservationId: string, getToken: GetToken): Promise<void>` (DELETE `/reservations/:id`). Re-exported from `../api/client`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/reservations/api.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
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
      { id: '550e8400-e29b-41d4-a716-446655440002', seatIds: ['550e8400-e29b-41d4-a716-446655440010'], status: 'held', expiresAt: '2026-06-19T12:00:00.000Z' },
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(res({ ok: false, status: 409, json: () => Promise.resolve(null) }));
    await expect(cancelReservation('r', getToken)).rejects.toBeInstanceOf(ApiError);
  });
});
```

> Note: the `z` import is only used to assert parse behavior indirectly; remove it if the linter flags it as unused. (It is not referenced — delete the `import { z } from 'zod';` line before running if needed.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run web:test -- src/reservations/api.spec.ts`
Expected: FAIL (`fetchMyReservations` / `cancelReservation` not exported).

- [ ] **Step 3: Write minimal implementation**

Modify `apps/web/src/reservations/api.ts`. Add the `z` import and the two helpers. The final file:

```ts
import { z } from 'zod';
import {
  CreateReservationRequestSchema,
  CreateReservationResponseSchema,
  CheckoutReviewResponseSchema,
  ReservationResponseSchema,
  type CreateReservationResponse,
  type CheckoutReviewResponse,
  type ReservationResponse,
} from '@linkz/shared';
import { apiFetch, type GetToken } from '../common/api';

export async function createReservation(
  seatIds: string[],
  getToken: GetToken,
): Promise<CreateReservationResponse> {
  const res = await apiFetch('/reservations', {
    method: 'POST',
    body: CreateReservationRequestSchema.parse({ seatIds }),
    getToken,
  });
  return CreateReservationResponseSchema.parse(await res.json());
}

export async function fetchCheckoutReview(
  reservationId: string,
  getToken: GetToken,
): Promise<CheckoutReviewResponse> {
  const res = await apiFetch(`/reservations/${encodeURIComponent(reservationId)}/checkout`, { getToken });
  return CheckoutReviewResponseSchema.parse(await res.json());
}

/** List the signed-in user's reservations (owner-gated). Used to resume an
 *  in-progress checkout when the seat map loads with a live held reservation. */
export async function fetchMyReservations(getToken: GetToken): Promise<ReservationResponse[]> {
  const res = await apiFetch('/reservations', { getToken });
  return z.array(ReservationResponseSchema).parse(await res.json());
}

/** Release (cancel) a held reservation — DELETE /reservations/:id. Used by the
 *  change-seats flow to free the seats before re-selecting them. */
export async function cancelReservation(reservationId: string, getToken: GetToken): Promise<void> {
  await apiFetch(`/reservations/${encodeURIComponent(reservationId)}`, { method: 'DELETE', getToken });
}
```

Modify `apps/web/src/api/client.ts` — replace the reservations re-export line:

```ts
export { createReservation, fetchCheckoutReview, fetchMyReservations, cancelReservation } from '../reservations/api';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpx nx run web:test -- src/reservations/api.spec.ts` — but use `pnpm nx run web:test -- src/reservations/api.spec.ts`.
Expected: PASS (4 tests).

Also run the existing reservations-related web tests to ensure no regression:
Run: `pnpm nx run web:test`
Expected: PASS (all web tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/reservations/api.ts apps/web/src/reservations/api.spec.ts apps/web/src/api/client.ts
git commit -m "feat(web): fetchMyReservations + cancelReservation API helpers"
```

---

### Task 3: `seats/resume.ts` — pure resume + reconcile decisions

**Files:**
- Create: `apps/web/src/seats/resume.ts`
- Test: `apps/web/src/seats/resume.spec.ts`

**Interfaces:**
- Consumes: `ReservationResponse` from `@linkz/shared`.
- Produces: `findLiveHold(reservations: ReservationResponse[], now: Date): ReservationResponse | null` and `reconcileSelection(seatIds: string[], seats: ReadonlyArray<{ id: string; status: string }>): string[]`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/seats/resume.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run web:test -- src/seats/resume.spec.ts`
Expected: FAIL (module `./resume` not found).

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/seats/resume.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run web:test -- src/seats/resume.spec.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/seats/resume.ts apps/web/src/seats/resume.spec.ts
git commit -m "feat(web): pure findLiveHold + reconcileSelection helpers"
```

---

### Task 4: `checkout/departure.ts` — build the change-seats intent

**Files:**
- Create: `apps/web/src/checkout/departure.ts`
- Test: `apps/web/src/checkout/departure.spec.ts`

**Interfaces:**
- Consumes: `CheckoutReviewResponse` from `@linkz/shared`; `PendingRelease` from `../reservations/pending-release`.
- Produces: `toPendingRelease(review: CheckoutReviewResponse): PendingRelease`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/checkout/departure.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { CheckoutReviewResponse } from '@linkz/shared';
import { toPendingRelease } from './departure';

const review: CheckoutReviewResponse = {
  reservation: {
    id: '550e8400-e29b-41d4-a716-446655440002',
    seatIds: ['550e8400-e29b-41d4-a716-446655440010', '550e8400-e29b-41d4-a716-446655440011'],
    status: 'held',
    expiresAt: '2026-06-19T12:02:30.000Z',
  },
  seats: [
    { id: '550e8400-e29b-41d4-a716-446655440010', label: 'A1', descriptor: 'Front row', price: 12000 },
    { id: '550e8400-e29b-41d4-a716-446655440011', label: 'A2', descriptor: 'Front row', price: 9500 },
  ],
  pricing: { seatPrice: 21500, serviceFee: 400, total: 21900, currency: 'usd' },
  contact: { email: 'a@b.com' },
  status: 'held',
};

describe('toPendingRelease', () => {
  it('maps the reservation id and seat ids from a checkout review', () => {
    expect(toPendingRelease(review)).toEqual({
      reservationId: '550e8400-e29b-41d4-a716-446655440002',
      seatIds: ['550e8400-e29b-41d4-a716-446655440010', '550e8400-e29b-41d4-a716-446655440011'],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run web:test -- src/checkout/departure.spec.ts`
Expected: FAIL (module `./departure` not found).

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/checkout/departure.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run web:test -- src/checkout/departure.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/checkout/departure.ts apps/web/src/checkout/departure.spec.ts
git commit -m "feat(web): toPendingRelease mapping for checkout departure"
```

---

### Task 5: Wire the entry logic into `SeatMap.tsx`

**Files:**
- Modify: `apps/web/src/seats/SeatMap.tsx`

**Interfaces:**
- Consumes (from earlier tasks): `consumePendingRelease` (Task 1), `cancelReservation` + `fetchMyReservations` (Task 2), `findLiveHold` + `reconcileSelection` (Task 3). Also existing `loadSelection`/`saveSelection` from `./selection`, `useNavigate` from `@solidjs/router`, `useClerk` (`auth`, `loaded`), `refetchSeats` from the seats resource.

> Note on `onProceed`: the entry effect (below) already resumes a live held reservation to checkout on mount, so by the time the user can click "Proceed to payment" from the seat map there is no live hold. `onProceed` therefore stays as-is (POST a new reservation from the current selection). The spec's "onProceed branches" is intentionally simplified to YAGNI — no live-hold branch is reachable.

- [ ] **Step 1: Read the current file**

Read `apps/web/src/seats/SeatMap.tsx` to confirm the import block and the signal/resource setup (lines ~1-30) before editing.

- [ ] **Step 2: Update imports**

In `apps/web/src/seats/SeatMap.tsx`, change the `solid-js` import to include `createEffect`:

```ts
import { createSignal, createResource, createEffect, Show, For, createMemo, type Component } from 'solid-js';
```

Add these imports after the existing `../api/client` import:

```ts
import { ApiError, createReservation, cancelReservation, fetchMyReservations } from '../api/client';
```
(replacing the existing `import { ApiError, createReservation } from '../api/client';` line)

And add near the `./selection` import:

```ts
import { loadSelection, saveSelection, clearSelection } from './selection';
import { consumePendingRelease } from '../reservations/pending-release';
import { findLiveHold, reconcileSelection } from './resume';
```

- [ ] **Step 3: Add the entry effect**

Inside `SeatMap`, after the `seatError` definition (after `const seatError = () => ...`), add:

```ts
  // Entry intent — runs once after Clerk loads:
  //  1. If we arrived from checkout via "Change seats" / browser Back, a
  //     pending-release record is in sessionStorage: release that reservation
  //     (DELETE /reservations/:id) and re-select its seats that are still
  //     available (drop any taken in a race).
  //  2. Otherwise, if the user has a live held reservation, resume them to
  //     its checkout page (the countdown latch lives on checkout).
  //  3. Otherwise, normal browse — selection is seeded from sessionStorage.
  // See docs/superpowers/specs/2026-06-19-change-seats-resume-and-reselect-design.md
  const [entryChecked, setEntryChecked] = createSignal(false);
  createEffect(() => {
    if (!loaded() || entryChecked()) return;
    setEntryChecked(true);
    void runEntry();
  });

  const runEntry = async () => {
    const pending = consumePendingRelease();
    if (pending) {
      if (isSignedIn()) {
        try {
          await cancelReservation(pending.reservationId, getToken);
        } catch {
          // Stale intent (already released/expired/confirmed) — keep going so
          // we still reselect whatever is available.
        }
        await refetchSeats();
        const reconciled = reconcileSelection(pending.seatIds, seats() ?? []);
        setSelectedIds(new Set(reconciled));
        saveSelection(reconciled);
      } else {
        // Signed out (no token to release): seed the selection best-effort; the
        // hold expires on its own.
        setSelectedIds(new Set(pending.seatIds));
        saveSelection(pending.seatIds);
      }
      return;
    }

    if (isSignedIn()) {
      try {
        const mine = await fetchMyReservations(getToken);
        const live = findLiveHold(mine, new Date());
        if (live) navigate(`/checkout/${live.id}`);
      } catch {
        // Network/auth failure — degrade to normal browse.
      }
    }
  };
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm nx run web:lint`
Expected: PASS (no errors). If `ApiError` is now unused, leave it — it is still used in `onProceed`. If the linter complains about an unused import, remove only that import.

- [ ] **Step 5: Run the web test suite**

Run: `pnpm nx run web:test`
Expected: PASS (no regressions; SeatMap has no component test, so this guards the pure helpers + api).

- [ ] **Step 6: Manual verification (run the app)**

Start the stack (`docker compose up -d`, `pnpm nx run api:serve`, `pnpm nx run web:serve`) and, with auth bypass on (`localStorage 'linkz:bypass-auth' = 'true'`):
1. Select a seat → "Proceed to payment" → checkout shows the countdown.
2. Click "← Change seats" → seat map shows the seat selected again; the seat is available (released); "Proceed to payment" works (creates a new reservation).
3. With a live hold, reload the page → you are redirected to `/checkout/:id` (resume).
4. Browser Back from checkout → same as step 2 (seat released + reselected).
5. Select the seat, proceed, then in another bypass user context confirm a held seat still 409s for the other user (held conflict with other users unchanged).

Expected: all behaviors match.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/seats/SeatMap.tsx
git commit -m "feat(web): seat map resumes live hold + releases/reselects on change-seats"
```

---

### Task 6: Wire the "Change seats" button + `popstate` into `CheckoutPage.tsx`

**Files:**
- Modify: `apps/web/src/checkout/CheckoutPage.tsx`

**Interfaces:**
- Consumes (from earlier tasks): `setPendingRelease` (Task 1), `toPendingRelease` (Task 4). Also existing `review` signal, `useNavigate` (add), `onCleanup`, `createEffect` (already imported).

- [ ] **Step 1: Read the current file**

Read `apps/web/src/checkout/CheckoutPage.tsx` to confirm imports (line 1-4), the `review` signal, and the "Change seats" `<A>` (line ~182).

- [ ] **Step 2: Update imports**

Change the `@solidjs/router` import to add `useNavigate`:

```ts
import { A, useParams, useNavigate } from '@solidjs/router';
```

Add after the `../api/client` import:

```ts
import { ApiError, fetchCheckoutReview, createPayment } from '../api/client';
import { setPendingRelease } from '../reservations/pending-release';
import { toPendingRelease } from './departure';
```

- [ ] **Step 3: Add `navigate`, the change-seats handler, and the popstate listener**

Inside `CheckoutPage`, after `const getToken = () => auth().getToken();` add:

```ts
  const navigate = useNavigate();

  // "Change seats" / browser Back: record the change-seats intent (reservation
  // id + seat ids) so the seat map can release the reservation and re-select
  // the surviving seats. The payment redirect (window.location.href) is a full
  // unload and does not fire popstate, so it never sets this intent.
  const onChangeSeats = () => {
    const r = review();
    if (r) setPendingRelease(toPendingRelease(r));
    navigate('/');
  };

  createEffect(() => {
    const onPop = () => {
      const r = review();
      if (r) setPendingRelease(toPendingRelease(r));
    };
    window.addEventListener('popstate', onPop);
    onCleanup(() => window.removeEventListener('popstate', onPop));
  });
```

- [ ] **Step 4: Replace the "Change seats" link with a button**

Find:

```tsx
                <A href="/" class="btn btn-secondary">← Change seats</A>
```

Replace with:

```tsx
                <button class="btn btn-secondary" type="button" onClick={onChangeSeats}>← Change seats</button>
```

Leave the error-state `<A href="/" class="btn btn-secondary">← Back to seat map</A>` as a plain link — in the error state the reservation is already gone/expired, so no release is needed.

- [ ] **Step 5: Typecheck + lint + tests**

Run: `pnpm nx run web:lint`
Expected: PASS.

Run: `pnpm nx run web:test`
Expected: PASS (no regressions). Note: `A` is still used for the error-state "Back to seat map" link and the success/cancel pages, so the `A` import stays.

- [ ] **Step 6: Manual verification (run the app)**

With the stack running and auth bypass on:
1. Select a seat → "Proceed to payment".
2. On checkout, click "← Change seats" → seat map shows the seat re-selected and available; confirm via the network panel that `DELETE /api/reservations/:id` fired.
3. Repeat step 1, then use the **browser Back button** → same outcome (seat released + reselected); confirm `DELETE` fired (the popstate listener wrote the intent before navigation).
4. Start a payment (`Pay`) and confirm the redirect to the provider/test-success URL does **not** fire a `DELETE` (the hold must survive for the payment flow).

Expected: all behaviors match.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/checkout/CheckoutPage.tsx
git commit -m "feat(web): checkout writes change-seats intent on Back / Change seats"
```

---

### Task 7: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Full web test/lint/build**

Run: `pnpm nx run-many -t test lint build -p web`
Expected: PASS for test, lint, build.

- [ ] **Step 2: Full repo test/lint/build (no backend changed, but guard regressions)**

Run: `pnpm nx run-many -t test lint build`
Expected: PASS.

- [ ] **Step 3: End-to-end manual pass**

Repeat the manual flows from Task 5 Step 6 and Task 6 Step 6 in one continuous session:
- change seats (button) → reselect → proceed again;
- browser Back → reselect → proceed again;
- reload with a live hold → resume to checkout;
- a second user holding a seat still 409s for the first (held conflict preserved).

Expected: all pass.

- [ ] **Step 4: Commit any remaining changes (e.g. arch doc note)**

The behavior matches the existing saga model (`held → released` on user cancel; resume is client navigation), so `arch/` requires no state-machine change. If a sentence clarifying the client resume/release flow is desired, add it to `arch/linkz-platform-architecture.md` and commit; otherwise skip.

```bash
git status
# If arch doc touched:
git add arch/linkz-platform-architecture.md
git commit -m "docs(arch): note client resume/release change-seats flow"
```

---

## Self-Review notes

- **Spec coverage:** resume-on-load → Task 5 (entry effect, `findLiveHold`); release+reselect on Back/Change-seats → Tasks 5+6 (`consumePendingRelease`, `cancelReservation`, `reconcileSelection`, `setPendingRelease`, popstate); countdown checkout-only → no change (already on checkout); no red X → no change; atomic whole-reservation release → reuses `DELETE /reservations/:id`. All covered.
- **`onProceed` branch:** deliberately kept as-is (YAGNI) — the entry effect makes a live-hold-on-seat-map state unreachable. Noted in Task 5.
- **Type consistency:** `PendingRelease` defined in Task 1, consumed in Tasks 4 and 6. `findLiveHold`/`reconcileSelection` defined in Task 3, consumed in Task 5. `fetchMyReservations`/`cancelReservation` defined in Task 2, re-exported in Task 2, consumed in Task 5. Names match across tasks.
- **Placeholder scan:** none — every code step contains the actual code.