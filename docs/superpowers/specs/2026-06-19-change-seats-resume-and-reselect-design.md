# Change seats — resume on load, release + reselect on back

Date: 2026-06-19
Status: Approved

## Problem

Repro: select a seat → "Proceed to payment" → "Change seats" (or browser Back).
The seat is now `held` server-side, and the seat map re-mounts with an empty
selection (sessionStorage was cleared on proceed). The held seat comes back with
`status: 'held'`, which the seat map treats like *someone else's* hold — greyed
out, disabled, not selectable. The user's own in-progress reservation is
invisible to the seat map, so they cannot change their pick; they can only start
over blind.

A second, related gap: if a user has a live hold and reloads the app (or returns
later), they land on the seat map with no indication an active checkout exists.

## Decisions (user)

- **Resume on load**: if the user has a live (held, not expired) reservation when
  the seat map loads, navigate to `/checkout/:reservationId`. The checkout page
  already shows the hold countdown latch, so a live hold always lands the user on
  the countdown.
- **Cancel scope**: atomic over the reservation id. Back / "Change seats" calls
  `DELETE /reservations/:id` to release the **whole** reservation; then reload the
  seat map with latest status.
- **Reselection**: the released reservation's seat ids are preserved as the
  selection. On the seat map, seats that are now `available` are auto-selected;
  seats that became unavailable (taken in a race) are dropped from the selection.
- **Countdown latch**: checkout page only (no countdown on the seat map — it never
  holds a live reservation in this flow).
- **Red X close icon**: none. Selecting/deselecting stays click-to-toggle.

## Design

No backend changes. Reuses `GET /reservations` (`listByUser`) and
`DELETE /reservations/:id` (`release`).

### Web client (`apps/web/src/reservations/api.ts`)

- `fetchMyReservations(getToken)` → `GET /reservations` →
  `z.array(ReservationResponseSchema).parse(...)`.
- `cancelReservation(id, getToken)` → `DELETE /reservations/:id` (204; `apiFetch`
  throws on non-2xx, no body to parse).
- Re-export both from `apps/web/src/api/client.ts`.

### Pending-release signal (`apps/web/src/reservations/pending-release.ts`, new)

A `sessionStorage` flag written on departure from checkout, consumed on seat-map
mount. It is the signal that distinguishes "coming from checkout to change
seats" (release + reselect) from "fresh load with a live hold" (resume →
checkout).

- `setPendingRelease({ reservationId, seatIds })`
- `consumePendingRelease(): { reservationId, seatIds } | null` (read + clear)
- `clearPendingRelease()`
- Manual narrowing in the style of `selection.ts` (reservationId uuid string,
  seatIds string[]). Key: `linkz:pending-release`.

### CheckoutPage (`apps/web/src/checkout/CheckoutPage.tsx`)

- "Change seats" becomes a `<button>`: writes `pending-release` from the loaded
  review's `reservationId` + `r.seats[].id`, then `navigate('/')`.
- A `popstate` listener (registered in a `createEffect`, removed via
  `onCleanup`) writes `pending-release` synchronously from the same review data,
  so **browser Back** also carries the signal. Payment redirect
  (`window.location.href = checkoutUrl`) is a full unload — no `popstate` — so it
  never sets the flag and never releases the hold.

### SeatMap (`apps/web/src/seats/SeatMap.tsx`) — on mount, signed in

1. Read `pending-release`:
   - if present → `saveSelection(seatIds)`; clear the flag;
     `await cancelReservation(reservationId)` (release; a stale 404/409 is
     ignored so reselect still proceeds); refetch seats; reconcile selection
     against seats (keep `available`, drop unavailable); save reconciled
     selection. Do **not** redirect to checkout.
2. Else fetch `fetchMyReservations`; if a live held reservation exists
   (`status === 'held'` && `expiresAt` && `new Date(expiresAt) > now`) →
   `navigate('/checkout/:reservationId')` (resume).
3. Else normal seat map (seed selection from sessionStorage as today).

`onProceed` branches: if a live hold is active → navigate to its checkout (no
new POST); else current behavior (POST new reservation). In practice, by the
time the user can click Proceed from the seat map, the resume/check has already
run, so the POST path is the fresh-selection path.

### Edge cases / invariants

- Signed-out: unchanged (holds don't exist; pre-hold sessionStorage selection +
  sign-in CTA).
- Expiry while on checkout: existing countdown→0 behavior; the resume filter
  `expiresAt > now` prevents redirecting to an expired-but-not-swept hold.
- Multiple held reservations: resume picks the one with the latest `expiresAt`;
  change-seats releases the specific flagged reservation (atomic per id).
- Stale `pending-release` flags are cleared on any seat-map mount; a stale
  `DELETE` (404/409) is ignored so reselect still proceeds.
- Interaction with the paid-seat bug (separate fix): after a successful payment
  the reservation is `confirmed`, not `held`, so the resume redirect (which
  targets `held`) does not fire for a paid reservation — correct, the user
  already paid.

## Testing (TDD, vitest)

- `pending-release.ts` spec: set / consume (read+clear) / clear; bad payload →
  null; follows `selection.ts` test style.
- `reservations/api.spec.ts`: `fetchMyReservations` parses the list;
  `cancelReservation` issues `DELETE` (follows `seats/api.spec.ts` style).
- SeatMap mount-logic: resume redirect on a live held hold; consume
  `pending-release` (release + reconcile keeps available / drops unavailable +
  clears flag); normal render otherwise.
- CheckoutPage: "Change seats" writes the flag + navigates; `popstate` writes the
  flag; payment-redirect path does not set the flag.

## Out of scope

Red X icon, seat-map countdown latch, per-seat removal, new backend endpoints,
adding seats to an existing hold, the paid-seat re-booking conflict (tracked
separately).