---
title: LinkZ - Platform Architecture
status: Draft
owner: hungpn1509@gmail.com
last_updated: 2026-06-20
sources:
  - arch/model.c4
  - arch/reservation.c4
  - arch/payment.c4
  - arch/linkz.erd.json
---

# LinkZ - Platform Architecture

## TL;DR

- **Auth** - identity delegated to [Clerk](https://dashboard.clerk.com); API is a stateless resource server that only validates JWTs. [§7.1](#71-authentication--authorization)
- **Seat concurrency** - Postgres partial-unique index + atomic insert arbitrate seat exclusivity. [§7.2](#72-seat-concurrency)
- **Saga** - failures before payment capture compensate (release the seat); steps after capture forward-recover (retry); if captured but seat was re-sold after hold expiry, Stripe refund is issued and reservation is marked `refunded`. [§7.4](#74-saga-semantics---compensation-vs-forward-recovery)

**Stack:** SolidJS SPA + NestJS resource server + Postgres 16, one hexagonal module per domain.

---

> **Diagrams are not inlined.** This document is the narrative and rationale; the [`arch/`](./) LikeC4 models and ERD are the source of truth for every diagram. To view them, install the two VS Code extensions this workspace already recommends - VS Code prompts you automatically when you open the repo, or run **Extensions: Show Recommended Extensions** (`@recommended`) from the Command Palette:
>
> - **LikeC4** (`likec4.likec4-vscode`) - open any [`arch/*.c4`](./) model, then click **Open Preview** on a `view { … }` block to render that view.
> - **ERD Editor** (`dineug.vuerd-vscode`) - open [`arch/linkz.erd.json`](./linkz.erd.json) to explore the data model interactively.
>
> Throughout, a citation like `model.c4` »index« names the **view** to open, and code is cited as `path:line` for jump-to-source.

---

## 1. Overview

LinkZ is a public seat-reservation platform demonstrating a money-moving workflow. Key production properties:

- **Correctness under contention** - many users may race for the same seat; never oversell, never lose a write.
- **Safe payment integration** - third-party gateway is eventually consistent and unreliable; webhooks arrive late, duplicated, or not at all.
- **Reliable multi-step completion** - booking spans hold - pay - invoice - ticket across local state and two external systems; must complete or compensate.

**Architectural thesis:** NestJS resource server (no credentials, no session state); hexagonal module per domain (ports & adapters); orchestrated saga splitting failure handling at the payment-capture line; database as the arbiter of hard invariants (seat exclusivity, exactly-once webhook processing).

---

## 2. Context

[View Context Diagram](./model.c4#L111) | [User Journey](./model.c4#L124) | [Try UI Flow](/docs/ux-design/index.html)

| Party | Role |
|---|---|
| **Customer** | Authenticated user who reserves and pays for a seat. |
| **Clerk** | Managed OIDC provider. Owns credentials, sessions, refresh-token rotation. LinkZ never sees a password. |
| **Payment Provider** | Stripe gateway. Hosts checkout, captures funds, emits signed webhooks. |

**Trust boundary.** API is a pure OIDC resource server - validates tokens, does not issue them. Browser authenticates directly with Clerk (OIDC + PKCE) and calls the API with a short-lived Bearer token. API validates each token against Clerk's JWKS on every request; no server-side session. See [§7.1](#71-authentication--authorization).

---

## 3. Containers

[View Overall Component Diagram](./model.c4#L116)

| Container | Tech | Port | Responsibility |
|---|---|---|---|
| **Web Client** | SolidJS SPA | `18601` | Seat map, OIDC login (PKCE), checkout. Thin and presentational; reaches the API through one typed client. |
| **LinkZ API** | NestJS | `18600`, prefix `/api` | Resource server. Validates JWTs; owns seat-hold concurrency, pricing, saga orchestration, and webhook idempotency. |
| **Postgres 16** | PostgreSQL + Drizzle | `18602` | Seats, reservations, saga state, payments, webhook-event ledger, invoices, tickets. |

Bootstrap (`apps/api/src/main.ts:6`) sets global `/api` prefix, enables CORS from configured web origin only, reads port from validated config. Raw request body preserved (`rawBody: true`) so webhook signatures can be verified byte-exact.

### API surface

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/health` | - | Liveness (`{ status: 'ok' }`). |
| `GET /api/me` | Bearer | Resolve current user. |
| `GET /api/seats`, `GET /api/seats/:id` | - | Seat list/detail with live `available \| held \| confirmed` status. |
| `GET /api/pricing` | - | Seat + service-fee pricing. |
| `POST /api/reservations` | Bearer | **Hold** a seat (atomic). |
| `GET /api/reservations` · `/:id` · `/:id/checkout` | Bearer | List owned - detail - checkout review. |
| `DELETE /api/reservations/:id` | Bearer | Release a held seat (204). |
| `POST /api/payments` | Bearer | Create a hosted-checkout session for a held reservation. |
| `GET /api/payments?reservationId=` | Bearer | **Poll** payment status (closes the webhook-latency gap). |
| `POST /api/payments/verify` | Bearer | **Pull** session status from Stripe and advance the saga; client fallback after 15 polling attempts with no webhook. |
| `POST /api/payments/webhook` | **Signed** | Receive PSP events; signature-verified, not Bearer-guarded. |
| `GET /api/invoices/:reservationId`, `GET /api/tickets/:reservationId` | Bearer | Fetch issued artifacts. |

Non-production builds also expose `test-payments` and `test-cleanup` controllers, hard-gated off in production (see [§7.7](#77-environments--test-seams)).

---

## 4. Components

[API Components](./model.c4#L117)

### 4.1 Hexagonal anatomy

Every domain module follows ports-and-adapters; dependency arrow always points inward toward pure logic:

```
controller (inbound adapter)  ->  service (use-case)  ->  domain (pure)
        HTTP/Zod DTO                  orchestrates   invariants, no I/O
                                          |
                         depends on a PORT (interface)
                     adapter (outbound): Drizzle repo / Stripe provider
```

- **Controller** - validates input with a Zod pipe, delegates, returns Zod-parsed responses. No business logic.
- **Service** - use-case orchestrator. Depends on **ports** (`*.ports.ts` injection tokens), never on concrete adapters.
- **Domain** - pure functions/guards (`reservation.domain.ts`, `payments.domain.ts`): ownership, hold-expiry, event mapping. No framework, no I/O.
- **Adapters** - Drizzle repositories and Stripe/test payment providers implement the ports. Swappable without touching the use-case.

### 4.2 Modules

[Saga Flow](./reservation.c4#L126)

| Module | Code | Role |
|---|---|---|
| **Auth** | `clerk/clerk.guard.ts`, `clerk.backend.ts`, `clerk.config.ts`; `users/user.resolver.ts` | `ClerkGuard` validates Bearer JWT via Clerk's JWKS; `UserResolver` maps Clerk `sub` - app user row, attaches `req.appUser`. |
| **Seats** | `seats/*` | Read seat inventory with live status (left-join to active reservations). Mutations via Reservations. |
| **Reservations** | `reservations/*` | Saga entry + reservation state machine. Atomic hold, owner-gated read/release, checkout review, system compensation. |
| **Payments** | `payments/*` | Create checkout intents; verify + idempotently process webhooks; poll status. Stripe and test providers behind one port. |
| **Saga processor** | `saga/saga.processor.ts` | Drives post-event steps: on success confirm - invoice - ticket; on failure release the seat. |
| **Invoices / Tickets** | `invoices/*`, `tickets/*` | Idempotent issuers (one row per reservation). Forward-recovery steps. |
| **Pricing** | `pricing/*` | Pure seat-price + service-fee computation. |
| **Supporting** | `common/zod-validation.pipe.ts`, `drizzle/`, `health/`, `me/` | DTO validation, DB connection, liveness, identity echo. |

---

## 5. Key flows

### 5.1 Reservation workflow

[Reservation Flow](./reservation.c4#L111) | [Seat States](./reservation.c4#L132)

Seat-status state machine: `available -> held -> confirmed`, with `held -> released` (cancel) and `held -> expired` (TTL). `released`/`expired` free the seat back to `available`. `expired -> refunded` covers the edge case where payment was captured but the seat was re-sold before the webhook arrived - Stripe refund is issued and the reservation is marked terminal.

### 5.2 Payment + webhook flow

[Payment Flow](./payment.c4#L38) | [Payment States](./payment.c4#L50) | [Payment Verify Flow](./payment.c4#L56)

1. Service owner-gates + prices the reservation, inserts a `pending` payment, creates a PSP checkout session with an **idempotency key** (`payments.service.ts:25`). `providerRef` persisted immediately for reconciliation (`:74`).
2. Customer completes payment on the hosted page.
3. **Push path (normal):** PSP POSTs a signed webhook. Provider adapter verifies signature against raw body (`payments.controller.ts:50`).
4. **Pull path (fallback):** after 15 silent 5-second polling attempts (~75 s) with no webhook, SPA calls `POST /payments/verify`. Service fetches session from Stripe, synthesises a `ProviderEvent` with id `verify_<sessionId>`, enters the same settle path.
5. `settle()` records the event in the ledger and updates the payment **in one transaction** (`drizzle.payments.repository.ts:55`); returns `true` if committed, `false` for duplicate (no-op).
6. Saga processor advances the booking (success) or compensates (failure).
7. `confirm()` accepts both `held` **and** `expired` reservation status - late webhooks that arrive after TTL still complete the booking.

Payment-status state machine: `pending -> succeeded` (webhook or verify pull), `pending -> failed` (failed/timeout), `succeeded -> refunded` (seat re-sold after hold expiry - Stripe refund issued).

---

## 6. Data model

[Entity Relation Diagram](./linkz.erd.json)

Seven tables. Non-obvious, load-bearing ones:

- **`reservations`** - `status ∈ {held, confirmed, released, expired, refunded}`, `saga_step` (orchestration cursor), `hold_expires_at` (nullable TTL), `version` (optimistic concurrency). Two indexes carry the invariants (`libs/database/src/lib/schema/reservations.ts`):
  - `uq_active_seat_partial` - partial-unique on `seat_id WHERE status IN ('held','confirmed')`. Seat-exclusivity invariant, in the schema, not the app.
  - `ix_reservation_sweep` - `(status, hold_expires_at)`, used by `HoldExpirySweeper` to reap elapsed holds.
- **`payments`** - `provider`, `provider_ref`, `idempotency_key`, `amount`, `currency`, `status ∈ {pending, succeeded, failed, refunded}`. Multiple attempts per reservation allowed; latest wins. `provider_ref` persisted at session-creation time so pull-verify path can retrieve the session without waiting for the webhook.
- **`webhook_events`** - event ledger, keyed by provider `event_id`. Unique constraint is the exactly-once dedupe mechanism for both push (`evt_xxx`) and pull (`verify_<sessionId>`) events.
- **`users`** (`external_id` = Clerk subject - no password column), **`seats`**, **`invoices`**, **`tickets`**.

---

## 7. Cross-cutting concerns & invariants

### 7.1 Authentication & authorization

- No passwords - identity fully delegated to Clerk (OIDC). API only validates JWTs; `users` row keys on Clerk's `external_id`.
- Refresh tokens never touch the API - Clerk owns issuance and rotation; browser exchanges them with Clerk directly.
- `ClerkGuard.canActivate` verifies each token via `verifyToken` against the JWKS, checking issuer/audience (`authorizedParties`) and expiry (`clerk/clerk.guard.ts:51`).
- **Authorization** - owner-gating at the use-case layer: `assertOwns` returns `404` for missing row, `403` for non-owner (`reservation.domain.ts`). Webhook route is exempt from Bearer auth - authenticated by **signature** instead.

### 7.2 Seat concurrency

The naive check-then-insert in app code has a textbook check-then-act race. We push the decision to the database:

- **Atomic hold.** `hold()` simply `INSERT`s the reservation. The partial-unique index rejects the second active row for the same seat with Postgres error `23505`, mapped to `409 Conflict` (`reservations.service.ts:34`). 100 concurrent requests for 3 seats - exactly 3 winners get holds; 97 get `409`. No oversell, no lost update, no app-level lock.
- **Optimistic concurrency on mutation.** Release is version-gated - `WHERE id = ? AND version = ? AND status = 'held'` - so a stale client cannot release a row that moved underneath it (`drizzle.reservations.repository.ts:75`). Confirm is status-gated to `held`, so a released/expired seat can never be confirmed.

**Hold expiry is lazy + read-reaped.** `assertActiveHold` rejects an expired hold at checkout-review time with `410 Gone` (`reservation.domain.ts`). Two mechanisms, both riding `ix_reservation_sweep`:

- **Read-time mapping.** `GET /api/seats` joins `reservations.hold_expires_at`; `SeatsService` maps a `held` seat whose `hold_expires_at <= now` to `available`.
- **Reap-on-read / reap-on-hold.** Seat read fire-and-forgets `HoldExpirySweeper.sweepExpiredHolds()`; `ReservationsService.hold()` awaits the same sweep before its atomic insert. Sweep flips `reservations` rows (`status='held' AND hold_expires_at <= now()` -> `expired`, version bumped) in one transaction.

No background timer required for correctness. See [ADR-002](#adr-002) and [ADR-006](#adr-006).

### 7.3 Webhook idempotency & reliability

- **Verify first.** Signature checked against raw body before any processing; bad signature is `400` (`payments.controller.ts:50`).
- **Exactly-once via the ledger.** `settle()` inserts into `webhook_events` keyed by `event_id` with `ON CONFLICT DO NOTHING`, inside the same transaction that updates the payment row. Re-delivered event - ledger row already present - no-op (`drizzle.payments.repository.ts:55`).
- **Push and pull share the same `settle()`.** Normal delivery uses real webhook `event_id` (`evt_xxx`). Pull-verify fallback synthesises `verify_<sessionId>` - different namespace so both events can be committed without collision.
- **Delay tolerated by polling + pull-verify.** SPA polls `GET /api/payments?reservationId=` every 5 s. After 15 attempts (~75 s) with no webhook, SPA calls `POST /payments/verify`. Persisted `provider_ref` enables reconciliation of any missed webhook.

**Saga is synchronous.** Processor runs in the same webhook handler after `settle()` returns `true`. No background worker or message queue - PSP re-delivery is the retry loop. See [ADR-005](#adr-005).

### 7.4 Saga semantics - compensation vs forward-recovery

Failure strategy switches at the **payment-capture line** ([Saga Flow](./reservation.c4#L126)):

- **Before capture - compensate.** Failed/expired payment releases the held seat (`releaseBySystem`, status-gated to `held`) (`saga.processor.ts:50`).
- **After capture - forward-recovery.** Invoice and ticket issuance are retried until they succeed. Both issuers are idempotent (one row per reservation).
- **Late-webhook tolerance.** `confirm()` accepts both `held` and `expired` reservation status. Late webhook still completes the booking if the seat is still available.
- **Captured-but-re-sold - refund.** If seat is re-held and sold to another user before a late webhook arrives, `confirm()` finds the seat unavailable. Stripe refund is issued; reservation transitions `expired -> refunded`. Only automatic refund path.

### 7.5 Validation & error handling

- **Boundary validation.** External input parsed with Zod at the edge via `ZodValidationPipe`; outbound responses re-parsed through `@linkz/shared` schemas.
- **HTTP taxonomy.** `401` (missing/invalid token), `403` (not owner), `404` (missing/enumeration-safe), `409` (seat taken, already paid, not held), `410` (hold expired), `400` (bad webhook signature, invalid DTO).
- **Gap.** Single global exception filter not yet implemented - errors surface through Nest's built-in exception layer.

### 7.6 Configuration & secrets

All config validated once at startup by a Zod schema (`libs/config/src/lib/config.ts`), read only through `@linkz/config` / Nest's `ConfigService` - never `process.env` in services. Secrets live in env files only. Production guardrails: schema fails fast if any auth-bypass variable is set under `NODE_ENV=production`; CORS restricted to configured web origin.

### 7.7 Environments & test seams

Test-auth bypass is defense-in-depth: `decideBypass` returns `real` whenever `NODE_ENV === 'production'` regardless of flags; config schema refuses to boot production if bypass env is present (`clerk/clerk.guard.ts:35`). `test-payments` and `test-cleanup` controllers exist only for non-prod E2E, gated the same way.

### 7.8 Observability

Today: `GET /api/health` liveness probe only.

**Gap:** No metrics or tracing yet. Target: per-step counters/histograms for the saga (`reservation_*`), webhook outcomes, hold contention, plus structured logs already emitted by the saga processor.

---

## 8. Appendix - Architecture Decision Records

### ADR-001 - Delegate identity to Clerk; the API is a resource server

**Context.** Login required, but storing passwords is liability without upside.

**Decision.** Delegate all identity to Clerk (OIDC + PKCE). API only validates JWTs via JWKS; stores no credentials, sessions, or refresh tokens.

**Consequences.** No password/breach surface; refresh-token rotation is Clerk's problem; stateless auth scales horizontally. Cost: hard dependency on Clerk availability and JWKS.

### ADR-002 - Enforce seat exclusivity with a partial-unique index, not app locks

**Context.** Tiny inventory, high contention, money on the line.

**Decision.** Partial-unique index (`status IN ('held','confirmed')`) + atomic insert make Postgres the single arbiter; unique violation maps to `409`.

**Consequences.** Oversell is structurally impossible; no distributed lock to operate. Trade-off: hold-expiry is lazy - slots free on next seat read or hold via `HoldExpirySweeper`. Status-gated `confirm`/`release` + `version` column close lost-update and stale-write races.

### ADR-003 - Split failure handling at the payment-capture line

**Context.** Booking spans local state and two external systems. Webhooks can arrive late - after hold TTL has elapsed and the seat has been re-sold.

**Decision.** Compensate (release the seat) for failures before capture; forward-recover (retry idempotent invoice/ticket issuance) for steps after capture. Edge case: if money was captured but seat was re-sold before webhook arrived, issue a Stripe refund and mark reservation `refunded`. Only automatic refund path; triggered by unrecoverable state, not transient failure.

**Consequences.** Money never silently reversed for normal failures; post-capture work always completes via retry. `confirm()` accepts `expired` status so late webhooks succeed when seat is still available. Requires every post-capture step to be idempotent.

### ADR-004 - Webhook idempotency via signed events + an event ledger

**Context.** PSP webhooks are unauthenticated-by-Bearer, retried, duplicated, reordered.

**Decision.** Verify signature against raw body, then record each `event_id` in a ledger with `ON CONFLICT DO NOTHING` in the same transaction as the state change.

**Consequences.** Exactly-once processing under at-least-once delivery; safe replays. Requires raw-body preservation at the HTTP layer (enabled in `main.ts`).

### ADR-005 - Synchronous saga processor; no message queue

**Context.** Confirm - invoice - ticket must survive a crash mid-flight after payment is captured.

**Decision.** `settle()` returns boolean (`true` = new event committed, `false` = duplicate). On `true`, saga processor runs **synchronously** in the same webhook handler. PSP already retries the webhook until it receives a `2xx`, which re-enters `settle()` and re-runs the saga. Every post-capture step is idempotent, so PSP re-delivery is the retry mechanism.

**Consequences.** Zero infra to operate; no race between worker poll and duplicate webhook. Trade-off: if invoice/ticket issuance throws after the transaction commits and the webhook is not re-delivered, the saga stalls - manual intervention needed. Acceptable for a 3-seat demo.

### ADR-006 - Lazy hold expiry; no background cron

**Context.** Held seats must eventually free up after TTL elapses.

**Decision.** Expiry is **lazy**: `HoldExpirySweeper.sweepExpiredHolds()` runs in-process, triggered by `hold()` (awaited) and optionally on seat reads (fire-and-forget). No background timer, no cron job. Correctness invariant satisfied at the database layer regardless - partial-unique index prevents a second `held/confirmed` row per seat whether or not expired rows have been reaped.

**Consequences.** Zero infra to operate. Trade-off: in the worst case, an expired seat may appear as `held` on the seat map briefly beyond the TTL. Adding a scheduled NestJS cron (`@Cron`) on top of the existing `HoldExpirySweeper` closes the promptness gap without changing any logic.

### ADR-007 - Hexagonal (ports & adapters) per module

**Decision.** Controllers and repositories/providers are adapters around a pure domain + use-case core that depends only on injected ports.

**Consequences.** Domain logic is unit-testable without a DB or HTTP; adapters (Drizzle, Stripe) are swappable. Cost: more files and indirection per feature.

### ADR-008 - Mock the PSP to the Stripe contract for deterministic local failure

**Decision.** A test provider implements the same port as Stripe and emits Stripe-shaped events, selectable via `PAYMENT_PROVIDER`.

**Consequences.** Failure/timeout/duplicate-webhook paths exercised deterministically in CI without hitting Stripe. Requires keeping the mock faithful to the real contract.
