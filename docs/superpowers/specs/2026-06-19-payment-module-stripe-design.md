# Payment Module (Stripe) — Design Spec

**Date:** 2026-06-19
**Status:** Approved (brainstorming) — pending spec review
**Module:** `apps/api/src/payments` (NestJS), with additions to `@linkz/shared` and `@linkz/config`

## Goal

Implement the Payments module from `arch/payment.c4`: create a hosted Stripe
Checkout Session for a reservation, then verify and **idempotently** process the
provider's signed webhook, advancing the reservation saga on
`payment.succeeded` via the transactional **outbox**.

API-first, TDD, hexagonal (mirrors the clean-architecture intent in
`reservation.c4`). **Keep it simple** — no speculative abstraction.

## Decisions (locked)

| Topic | Decision |
|---|---|
| Stripe model | **Checkout Session (hosted)**. `POST /api/payments` returns a `checkoutUrl`. |
| Saga hand-off | **Outbox event**. On success, insert `outbox(type='payment.succeeded')`; the (future) saga drains it. No dependency on a reservations module. |
| Provider | **Real `stripe` SDK**, behind a `PaymentProviderPort` so the arch's mock provider can swap in. Signature verified with `stripe.webhooks.constructEvent`. |
| Authorization/validation | **Stubbed** — `authorizeCreatePayment()` returns `true` always, with a TODO describing the real check. The seam exists; strict checks land with the reservations module. |
| Price | From config (one price for all 3 seats). The `seats` table has **no** price column and we will not add one. |
| Schema | **No DB changes.** Reuses existing `payments`, `webhook_events`, `outbox` tables. |

## Non-goals

- No reservations/saga module (only the outbox seam to it).
- No refund trigger (the `payments.refunded` state stays unused for now).
- No real seat-price model; no per-seat pricing.
- No frontend work (separate task). The SPA only needs to redirect to `checkoutUrl`.

## Invariants honored (from CLAUDE.md / arch)

1. **Signature verification** before any processing (`constructEvent`; bad sig → `400`).
2. **Exactly-once** processing via the `webhook_events` ledger PK (`event_id`).
3. **Confirm only on `payment.succeeded`** — success is the sole trigger for the
   `payment.succeeded` outbox event.
4. **Saga discipline** — pre-capture failure emits a compensation signal
   (`payment.failed` outbox); we never auto-refund.

## Module structure

```
apps/api/src/payments/
├── payments.module.ts
├── payments.controller.ts            # HTTP adapter: POST /payments, POST /payments/webhook
├── payments.service.ts               # application use-cases over ports
├── payments.domain.ts                # pure: authorizeCreatePayment() stub + event→status mapping
├── payments.ports.ts                 # PaymentProviderPort + PaymentsRepositoryPort (interfaces + DI tokens)
└── adapters/
    ├── stripe.payment-provider.ts    # implements PaymentProviderPort via `stripe`
    └── drizzle.payments.repository.ts# implements PaymentsRepositoryPort via DrizzleService
```

## API contract

### `POST /api/payments` — Clerk-guarded
- **Body** (Zod `CreatePaymentRequestSchema`): `{ reservationId: string /* uuid */ }`
- **201** `{ paymentId: string, checkoutUrl: string }`
- **Errors:** `400` invalid body · `403` `authorizeCreatePayment` false (never, for now) · `409` reservation already has a `succeeded` payment.
- **Idempotent create:** if a `pending` payment already exists for the
  reservation, reuse it — call the provider with the **same idempotency key**
  (Stripe replays the same Session) and return the same `checkoutUrl`. No
  duplicate `payments` row (`idempotency_key` is unique).

### `POST /api/payments/webhook` — no Clerk guard; Stripe signature
- Requires the **raw request body**. We enable
  `NestFactory.create(AppModule, { rawBody: true })` in `main.ts` and read
  `req.rawBody` (`RawBodyRequest<Request>`).
- **400** only when signature verification fails.
- **200** in all other cases (ack), including duplicates and ignored event types.

## Ports

```ts
// PaymentProviderPort
createCheckoutSession(input: {
  paymentId: string; reservationId: string;
  amount: number; currency: string; idempotencyKey: string;
}): Promise<{ providerRef: string; checkoutUrl: string }>;
// sets Stripe metadata { paymentId, reservationId } for webhook correlation

constructEvent(rawBody: Buffer | string, signature: string): ProviderEvent; // throws on bad sig

// PaymentsRepositoryPort
findPaymentByReservation(reservationId: string): Promise<PaymentRow | null>;
insertPending(row: NewPayment): Promise<PaymentRow>;
findPaymentById(paymentId: string): Promise<PaymentRow | null>;
recordWebhookEvent(e: { eventId: string; type: string; payload: unknown }): Promise<boolean>;
  // INSERT ... ON CONFLICT (event_id) DO NOTHING → true if inserted, false if duplicate
markSucceeded(paymentId: string): Promise<void>; // tx: payment=succeeded + outbox + ledger=processed
markFailed(paymentId: string): Promise<void>;    // tx: payment=failed   + outbox + ledger=processed
```

DI tokens (`PAYMENT_PROVIDER`, `PAYMENTS_REPOSITORY`) bind interfaces to the
Stripe/Drizzle adapters so the service depends on ports, not concretions.

## Data flow

### Create payment
1. `authorizeCreatePayment(reservationId, req.user)` → always `true` (stub).
2. `findPaymentByReservation`: if `succeeded` → `409`; if `pending` → reuse.
3. Otherwise `insertPending` (provider `'stripe'`, status `'pending'`,
   `idempotency_key = "pay_<reservationId>"`, amount/currency from config).
4. `provider.createCheckoutSession({...})` with the idempotency key.
5. Return `{ paymentId, checkoutUrl }`.

### Webhook (idempotency core)
```
event = provider.constructEvent(rawBody, sig)          // 400 if invalid
inserted = repo.recordWebhookEvent(event)              // dedupe via ledger PK
if (!inserted) return 200                              // already handled

switch (event.type) {                                  // each branch is one DB tx
  'checkout.session.completed' (payment_status='paid'):
      repo.markSucceeded(metadata.paymentId)           // payment + outbox 'payment.succeeded'
  'payment_intent.payment_failed':
      repo.markFailed(metadata.paymentId)              // payment + outbox 'payment.failed'
  default: /* ignored type — ledger row stays 'received'; just ack */
}
return 200
```
Correlation is by `event.data.object.metadata.paymentId` (set at session
creation) — no session/intent id juggling.

## Config + shared additions (additive; another dev may be in these files)

**`@linkz/config` `apiEnvSchema`:**
`STRIPE_SECRET_KEY` (required), `STRIPE_WEBHOOK_SECRET` (required),
`STRIPE_SUCCESS_URL` (default `http://localhost:18601/checkout/success`),
`STRIPE_CANCEL_URL` (default `http://localhost:18601/checkout/cancel`),
`SEAT_PRICE_AMOUNT` (coerced number, default `5000`),
`SEAT_PRICE_CURRENCY` (default `usd`).

**`@linkz/shared`:** `CreatePaymentRequestSchema`, `CreatePaymentResponseSchema`
(+ `z.infer` types).

## Error handling

- Create body validated by the existing Zod pipe; errors surface through the
  existing global exception filter.
- Webhook leaks nothing: bad signature → `400`; if a handler throws after the
  ledger insert, the ledger row is updated to `failed` and the error is logged
  for retry/inspection (Stripe will retry the delivery).

## Testing (TDD, red → green per unit)

1. **`payments.domain`** — `authorizeCreatePayment` returns `true`; event→status mapping.
2. **`payments.service`** — mocked ports:
   - create: inserts pending + returns url; reuses existing pending; `409` on succeeded.
   - webhook: invalid sig → throws/400; duplicate (`recordWebhookEvent`=false) → ack no-op; `checkout.session.completed` → `markSucceeded`; `payment_intent.payment_failed` → `markFailed`; unknown type → ack no-op.
3. **`stripe.payment-provider`** — `constructEvent` with a signed fixture (valid + tampered); `createCheckoutSession` maps params + metadata (mock the `stripe` SDK).
4. **`@linkz/shared` / `@linkz/config`** — schema + new-env tests.
5. **`payments.controller`** — thin delegation; raw-body wiring for webhook.

Primary suite is unit tests over mocked ports — no mutation of the shared
Postgres. At most one repository test using a transaction that rolls back.

## Isolation

Another developer is active in the workspace. Implementation runs in a **git
worktree** on a feature branch; tests rely on mocked ports so the shared
Postgres (port 18602) is not mutated.

## Files touched

- **New:** the `apps/api/src/payments/**` tree + specs; spec/plan docs.
- **Modified (additive):** `apps/api/src/app/app.module.ts` (register `PaymentsModule`), `apps/api/src/main.ts` (`rawBody: true`), `libs/config/src/lib/config.ts`, `libs/shared/src/lib/shared.ts`.
