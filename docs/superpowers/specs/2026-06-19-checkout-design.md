# Checkout Flow — Design Spec

- **Date:** 2026-06-19
- **Branch:** `feat/web-clerk-ui`
- **Status:** Approved
- **Scope owner:** checkout (review → pay → poll) + the reservations backend module it depends on

## 1. Goal

Implement the checkout step of the reservation journey (step 3 of 5: Sign in › Pick seat › **Checkout** › Pay › Ticket). A signed-in user who has picked a seat reviews their held reservation, pays via Stripe hosted checkout, returns to a success/cancel page, and polls payment status until terminal.

The parallel pick-seat flow owns the **seat-map UI**; this spec owns the **reservations backend** (atomic hold + read + release) that the seat-map calls into, the **payments fixes** needed for a correct checkout, and the **checkout/pay/success/cancel web screens**.

## 2. Scope decisions (locked)

| Decision | Choice |
|---|---|
| Flow end | **Review → Pay → Poll**. The saga outbox consumer (confirm seat on `payment.succeeded` / release on `failed`) is a **separate worker — out of scope.** |
| Reservations module | **Build it** (does not exist). Parallel flow owns seat-map UI; this spec owns the reservations resource. |
| Pricing | `seats.price` (minor units, joined via `reservation.seatId`) **+ flat service fee** from config (default 400 = $4.00). Total = seat + fee. |
| Hold TTL | **15 minutes** (matches seat-map UI copy). Checkout rejects expired holds inline. |
| Stripe mode | **Hosted checkout** (Stripe Checkout Sessions) — matches existing code + UI ("Hosted checkout"). |

## 3. Architecture invariants (must not weaken)

From `arch/reservation.c4`, `arch/payment.c4`, `CLAUDE.md`:

- **Seat concurrency**: at most one active reservation per seat via partial-unique index `uq_active_seat_partial UNIQUE(seat_id) WHERE status IN ('held','confirmed')` + atomic hold. Never replace with app-level checks alone.
- **Webhook idempotency**: verify provider signature; process each event once via `webhook_events` ledger; confirm a reservation only on `payment.succeeded`.
- **Saga**: failures *before* capture compensate (release seat); steps *after* capture are forward-recovery (retry), never auto-refund. The confirmation/release worker is out of scope here but the outbox events it will consume must keep flowing.
- **Auth**: Clerk OIDC/JWKS, 90-day session, no password storage. Identity via `ClerkGuard` (sets `req.user` = Clerk sub) + `UserResolver` (sets `req.appUser` = internal user). Never call Clerk/UserRepository from a controller directly.

Seat-status SM: `available→held→confirmed|released|expired`; `released|expired→available`. Persisted `reservations.status` ∈ `held|confirmed|released|expired` only (`available` is derived — no active row).
Payment-status SM: `pending→succeeded|failed`; `succeeded→refunded`.

## 4. ERD entities (existing, unchanged)

`users(id, external_id, email, name, created_at)`, `seats(id, label, price, created_at)`, `reservations(id, seat_id, user_id, status, saga_step, hold_expires_at, version, created_at, updated_at)`, `payments(id, reservation_id, provider, provider_ref, idempotency_key, amount, currency, status, timestamps)`, `webhook_events`, `outbox`, `invoices`, `tickets`. Schema is fully defined in `libs/database/src/lib/schema/`; no schema changes required.

## 5. Backend design

### 5.1 New `apps/api/src/reservations/` module

- **Port** `RESERVATIONS_REPOSITORY` (`reservations.ports.ts`):
  - `hold(seatId, userId, holdExpiresAt): Promise<Reservation | null>` — atomic insert; `null` = conflict (seat already active).
  - `findById(id): Promise<Reservation | null>`
  - `findOwnedBy(userId): Promise<Reservation[]>`
  - `release(id, version): Promise<boolean>` — optimistic `held→released` on `version` match.
- **Domain** `reservation.domain.ts` (pure, unit-tested):
  - `canHold`, state-machine transition table (`available→held`, `held→confirmed/released/expired`, …).
  - `isHoldExpired(reservation, now): boolean` (`hold_expires_at <= now`).
  - `assertOwns(reservation, userId)` → throws `ForbiddenException` on mismatch.
- **Service** `ReservationsService`:
  - `holdSeat(seatId, userId)`: seat exists (`SeatsRepository.findById`, else `NotFoundException`) → `hold(..., now + HOLD_TTL_MINUTES)` → `null` ⇒ `ConflictException('Seat is already held')`. Returns reservation.
  - `getCheckoutReview(reservationId, userId)`: load reservation (`NotFoundException`) → `assertOwns` → `isHoldExpired` ⇒ `GoneException('Hold expired')` → join seat (label, descriptor, price) → `computePricing(seatPrice, fee)` → return `CheckoutReviewResponse`.
  - `release(reservationId, userId)`: load → `assertOwns` → `release(id, version)` (`GoneException` if already released/confirmed).
- **Controller** `reservations.controller.ts`, all `@UseGuards(ClerkGuard, UserResolver)`, identity from `req.appUser`:
  - `POST /api/reservations` body `HoldSeatRequestSchema{seatId}` → `holdSeat` → `201 ReservationResponse`.
  - `GET /api/reservations/:id` → `getCheckoutReview` → `200 CheckoutReviewResponse` (owner-gated).
  - `DELETE /api/reservations/:id` → `release` → `204` (for "Change seat" / cancel).
  - `GET /api/reservations` → `findOwnedBy` → `200 ReservationResponse[]`.
- **Drizzle adapter** `adapters/drizzle.reservations.repository.ts`:
  - Atomic hold: `INSERT INTO reservations (… status='held', hold_expires_at=…) ON CONFLICT (seat_id) WHERE status IN ('held','confirmed') DO NOTHING RETURNING *`; `returning()` empty ⇒ return `null`. The partial-index conflict target is the hard guard.
  - `release`: `UPDATE … SET status='released' WHERE id=? AND version=? AND status='held'`.
- **Module** `reservations.module.ts`: imports Drizzle + Clerk + Users + Seats; binds `RESERVATIONS_REPOSITORY → DrizzleReservationsRepository`; exports `ReservationsService` + port. Added to `AppModule.imports`.

### 5.2 `PaymentsModule` fixes (behavior changes to existing code)

- **`authorizeCreatePayment`** (`payments.domain.ts`, currently a stub): real check — reservation exists, `assertOwns(reservation, userId)`, `status === 'held'`, `!isHoldExpired`, no existing `succeeded` payment. Throws `NotFoundException/ForbiddenException/ConflictException/GoneException`. Requires `PaymentsModule` to import `ReservationsModule` + `UsersModule`.
- **Price source** (`payments.service.ts` `createPayment`): load reservation → seat, `amount = seat.price + SERVICE_FEE_AMOUNT`; pass `amount`+`currency` to the provider. **Remove the `PAYMENT_PRICE` config token** from `PaymentsModule` (seat row is now the source of truth); `SERVICE_FEE_AMOUNT`/`SERVICE_FEE_CURRENCY` come from `@linkz/config`.
- **Persist `providerRef`**: after `createCheckoutSession`, update the payment row's `provider_ref` (fixes the null-until-webhook gap).
- **New poll endpoint** `GET /api/payments?reservationId=:reservationId` → `PaymentResponse{id, reservationId, status, amount, currency}`, owner-gated (via reservation ownership). The success page only has `reservationId` (from the Stripe redirect URL), so lookup is by `reservationId`, not payment id. Returns the latest payment for that reservation.
- **Event mapping** (`payments.domain.ts` `mapEvent`): add `checkout.session.expired → 'failed'` so polling surfaces expiry. Seat release on failed stays the saga worker's job (out of scope); the 15-min TTL covers stranded holds. (Known gap — see §9.)

Idempotency key `pay_${reservationId}` and the `webhook_events` ledger / outbox emission in `DrizzlePaymentsRepository.settle` remain unchanged.

### 5.3 Pricing — pure module

`apps/api/src/pricing/pricing.ts` (or `reservations/pricing.ts`): `computePricing(seatPriceMinor, feeMinor): { seatPrice, serviceFee, total }`. Shared by review + pay so amounts cannot drift. Unit-tested.

### 5.4 Config (`libs/config`)

`apiEnvSchema` add: `SERVICE_FEE_AMOUNT` (default 400), `SERVICE_FEE_CURRENCY` (default `usd`), `HOLD_TTL_MINUTES` (default 15). `webEnvSchema` add: `VITE_API_URL` (default `/api`). Stripe success/cancel URLs already exist (`STRIPE_SUCCESS_URL`/`STRIPE_CANCEL_URL`, defaults `/checkout/success`|`/checkout/cancel`).

## 6. Web design (`apps/web`)

### 6.1 Router + navigation

- Install `@solidjs/router`. Wrap `Inner` in `<Router>`; routes: `/` (signed-out hero / signed-in SeatMap), `/checkout/:reservationId`, `/checkout/success`, `/checkout/cancel`. Preserve existing ClerkProvider + signed-in/out gating.
- SeatMap "Proceed to payment" button → `POST /api/reservations {seatId}` via authed client → `201` ⇒ `navigate(\`/checkout/${id}\`)`; `409` ⇒ refresh seats + "that seat was just taken"; `401` ⇒ sign-in prompt. Hold is created on *proceed*, not on select.

### 6.2 Authed API client

`apps/web/src/api/client.ts`: `apiFetch<T>(path, opts, schema)` injects `Authorization: Bearer ${await auth().getToken()}`, parses with the given Zod schema, throws typed errors on non-2xx. Reused by SeatMap (hold), Checkout (review + pay), Success (poll), and existing `fetchMe`/`fetchSeats` where auth is needed.

### 6.3 Pages

- **`CheckoutPage`** (`/checkout/:reservationId`): `createResource` → `GET /api/reservations/:id` (review). Renders steps nav (3 active), seat card (label + descriptor + `Held` badge), summary rows (seat price, service fee, total), contact card (email via `GET /api/me`, "Hosted checkout"), "← Change seat" (`/`), **"Pay $total"** → `POST /api/payments {reservationId}` → `window.location.href = checkoutUrl`. States via `<Show>`: loading, not-found, **hold-expired** (re-pick prompt), payment-already-pending. SolidJS conventions: no prop destructuring, `<Show>`/`<For>`, signals + `createResource`.
- **`CheckoutSuccess`** (`/checkout/success?reservationId=…`): poll `GET /api/payments?reservationId=…` every ~2s up to ~60s until `succeeded`/`failed`/`refunded`. Show "Payment succeeded — confirming your ticket" (confirmation is the separate saga worker) / "Payment failed" with retry.
- **`CheckoutCancel`** (`/checkout/cancel?reservationId=…`): "Payment cancelled — your seat hold is still active. Retry or change seat." Links back to `/checkout/:reservationId` and `/`.

### 6.4 Styles

Port the checkout mock's `.steps/.step/.step-dot/.step-label/.summary-row/.badge/.badge-green/.user-chip/.avatar` into `apps/web/src/index.css` (reusing existing `--brand-*`/`--gray-*` tokens + `.card/.btn/.page-title` already present).

## 7. Shared schemas (`libs/shared`)

Add to `libs/shared/src/lib/shared.ts`: `HoldSeatRequestSchema{seatId:uuid}`, `ReservationStatusSchema` enum `held|confirmed|released|expired`, `ReservationResponseSchema{id,seatId,status,expiresAt}`, `CheckoutReviewResponseSchema{reservation, seat:{id,label,descriptor,price}, pricing:{seatPrice,serviceFee,total,currency}, contact:{email}, status}`, `PaymentStatusSchema` enum `pending|succeeded|failed|refunded`, `PaymentResponseSchema{id,reservationId,status,amount,currency}`. Widen `SeatStatusSchema` to include `confirmed`. zod v4; derive types via `z.infer`.

## 8. Testing (TDD, vitest + Playwright)

Unit (vitest, `pnpm nx run <proj>:test`):
- `reservation.domain.spec` (SM transitions, `isHoldExpired`, `assertOwns`).
- `reservations.service.spec` (hold happy/conflict/not-found, review ownership/expired, release).
- `drizzle.reservations.repository.spec` (atomic hold concurrency — integration vs `linkz_test` DB per memory note; `onConflictDoNothing` returns null on conflict).
- `payments.service.spec` (authorize: owner-mismatch/ not-held/ expired/ duplicate-succeeded; price = seat+fee; `providerRef` persisted).
- `payments.controller.spec` (`GET /api/payments?reservationId=…` owner-gated).
- `pricing.spec` (`computePricing`).
- Web: `api/client.spec`, `CheckoutPage.spec` (loading/expired/pay-redirect states via `@solidjs/testing-library`).

E2E (Playwright, `apps/e2e/src/`, `pnpm nx run e2e:e2e`) — written first (TDD), against the real api+web via the existing `playwright.config.mts` webServer:
- `checkout-journey.spec`: sign in (seeded Clerk test session) → pick seat → "Proceed to payment" → review renders correct seat/fee/total → "Pay" → Stripe test-mode hosted checkout → success redirect → polls to `succeeded`.
- `checkout-edge.spec`: hold expired mid-checkout (seed past `hold_expires_at`) → expired state; seat taken mid-hold → 409 on proceed; cancel redirect → cancel page.
- **Fix**: `apps/e2e/project.json` target `config` references `playwright.config.ts` but the file is `playwright.config.mts` — align them.

## 9. Out of scope (documented gaps, not silently dropped)

- Saga outbox consumer: `payment.succeeded → confirm seat` (forward-recovery: invoice/ticket), `payment.failed → release seat` (compensation).
- Hold-expiry sweep worker (`held→expired` via `ix_reservation_sweep`); checkout only rejects inline.
- Refund flow (`charge.refunded → refunded`).
- Stripe `async_payment_*` / `payment_intent.canceled` event coverage.
- Ticket page (step 5).
- Reconcile Lead-Engineer "3 seats" vs seat-map 12-seat mock (product decision, not checkout).

## 10. Architecture sync

`arch/` already models the saga, seat SM, payment SM, and all ERD entities this implements — no structural change. Run `npx likec4 validate arch` after implementation. Optionally annotate `reservation.c4` with the 15-min TTL + service-fee values if a natural spot exists.

## 11. Implementation slices (fanout subagents)

1. **Foundation (sequential)**: install `@solidjs/router`; shared schemas + config additions; fix e2e `project.json` config path. Everything depends on the schemas.
2. **Parallel**: (A) ReservationsModule + unit tests; (B) Payments fixes + `GET /payments/:id` + unit tests. B consumes A's `RESERVATIONS_REPOSITORY`/`ReservationsService` port — B starts once A's port contract is committed, or codes against the fixed port interface.
3. **Parallel after API contracts**: (C) web router + authed client + Checkout/Success/Cancel + SeatMap wiring + styles + unit tests; (D) Playwright E2E specs (TDD) — D goes red against the contract first, green as C lands.
4. **Verify**: `pnpm nx run-many -t test lint build` + `pnpm nx run e2e:e2e`; drive the journey with Playwright MCP; `npx likec4 validate arch`.