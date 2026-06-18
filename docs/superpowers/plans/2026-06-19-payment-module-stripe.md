# Payment Module (Stripe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Stripe-backed Payments module to `apps/api` — create a hosted Checkout Session for a reservation, then verify and idempotently process the signed webhook, advancing the saga via the transactional outbox.

**Architecture:** Hexagonal NestJS module (`apps/api/src/payments`) mirroring `reservation.c4`: a thin controller (HTTP adapter) → a `PaymentsService` (use-cases) → two ports (`PaymentProviderPort`, `PaymentsRepositoryPort`) with a Stripe adapter and a Drizzle adapter. Pure domain helpers (`authorizeCreatePayment`, `mapEvent`). Reuses the existing `payments` / `webhook_events` / `outbox` tables (no schema changes).

**Tech Stack:** NestJS 11, `stripe` SDK, Drizzle + postgres-js, Zod (`@linkz/shared` schemas, `@linkz/config` env), Vitest.

## Global Constraints

- Ports: **API 18600 · Web 18601 · Postgres(host) 18602**. `DATABASE_URL=postgres://linkz:linkz@localhost:18602/linkz`.
- **No DB schema changes.** Reuse `payments`, `webhook_events`, `outbox`.
- **Invariants:** verify Stripe signature before processing (bad sig → 400); process each event exactly once via the `webhook_events` PK ledger; emit the `payment.succeeded` outbox event only on a paid success; pre-capture failure emits `payment.failed` (never auto-refund).
- **Authorization is a stub** — `authorizeCreatePayment()` returns `true` always with a TODO. No reservations module exists yet.
- **Config additions are additive** to `apiEnvSchema`; Stripe keys are required (the existing config test + `.env.example` are updated to match).
- **Keep it simple** — no speculative abstraction. TS `strict`, no `any` (use `unknown` + narrow). Validate input with Zod at the boundary.
- **TDD** every code-bearing unit: failing test → minimal impl → green → commit.
- **Isolation:** another dev is active — work in a git worktree; tests use mocked ports or a transaction-rollback integration test (never mutate the shared Postgres).
- Commit prefix `feat:`/`test:`/`chore:`; end messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure (target)

```
apps/api/src/
├── common/zod-validation.pipe.ts            # reusable Zod pipe (+ spec)
├── payments/
│   ├── payments.ports.ts                     # types + port interfaces + DI tokens
│   ├── payments.domain.ts                    # authorizeCreatePayment() + mapEvent() (+ spec)
│   ├── payments.service.ts                    # use-cases (+ spec)
│   ├── payments.controller.ts                # POST /payments, POST /payments/webhook (+ spec)
│   ├── payments.module.ts                     # wiring (provider/repo/price tokens)
│   └── adapters/
│       ├── stripe.payment-provider.ts         # PaymentProviderPort via `stripe` (+ spec)
│       └── drizzle.payments.repository.ts      # PaymentsRepositoryPort via Drizzle (+ integration spec)
├── app/app.module.ts                         # MODIFY: import PaymentsModule
└── main.ts                                   # MODIFY: NestFactory.create(AppModule, { rawBody: true })

libs/shared/src/lib/shared.ts                 # MODIFY: Create payment Zod schemas (+ spec)
libs/config/src/lib/config.ts                 # MODIFY: Stripe + price env (+ spec)
libs/database/src/index.ts                    # MODIFY: re-export schema tables
.env.example                                  # MODIFY: Stripe + price vars
```

---

## Task 1: Shared payment schemas (`@linkz/shared`)

**Files:**
- Modify: `libs/shared/src/lib/shared.ts`
- Test: `libs/shared/src/lib/shared.spec.ts`

**Interfaces:**
- Produces: `CreatePaymentRequestSchema` (`{ reservationId: string }`), `CreatePaymentResponseSchema` (`{ paymentId: string; checkoutUrl: string }`), types `CreatePaymentRequest`, `CreatePaymentResponse`.

- [ ] **Step 1: Add failing tests** — append to `libs/shared/src/lib/shared.spec.ts`:

```ts
import { CreatePaymentRequestSchema, CreatePaymentResponseSchema } from './shared';

describe('CreatePaymentRequestSchema', () => {
  it('accepts a uuid reservationId', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    expect(CreatePaymentRequestSchema.parse({ reservationId: id })).toEqual({ reservationId: id });
  });
  it('rejects a non-uuid reservationId', () => {
    expect(() => CreatePaymentRequestSchema.parse({ reservationId: 'nope' })).toThrow();
  });
});

describe('CreatePaymentResponseSchema', () => {
  it('parses a payment id + checkout url', () => {
    const out = CreatePaymentResponseSchema.parse({ paymentId: 'p1', checkoutUrl: 'https://stripe/cs_test' });
    expect(out).toEqual({ paymentId: 'p1', checkoutUrl: 'https://stripe/cs_test' });
  });
  it('rejects a non-url checkoutUrl', () => {
    expect(() => CreatePaymentResponseSchema.parse({ paymentId: 'p1', checkoutUrl: 'nope' })).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm nx run shared:test`
Expected: FAIL (`CreatePaymentRequestSchema` not exported).

- [ ] **Step 3: Implement** — append to `libs/shared/src/lib/shared.ts`:

```ts
export const CreatePaymentRequestSchema = z.object({
  reservationId: z.string().uuid(),
});
export type CreatePaymentRequest = z.infer<typeof CreatePaymentRequestSchema>;

export const CreatePaymentResponseSchema = z.object({
  paymentId: z.string().min(1),
  checkoutUrl: z.string().url(),
});
export type CreatePaymentResponse = z.infer<typeof CreatePaymentResponseSchema>;
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm nx run shared:test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/shared && git commit -m "feat(shared): create-payment request/response schemas

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Stripe + price env (`@linkz/config`)

**Files:**
- Modify: `libs/config/src/lib/config.ts`, `libs/config/src/lib/config.spec.ts`, `.env.example`

**Interfaces:**
- Produces: `apiEnvSchema` gains `STRIPE_SECRET_KEY` (required), `STRIPE_WEBHOOK_SECRET` (required), `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL`, `SEAT_PRICE_AMOUNT` (number), `SEAT_PRICE_CURRENCY`.

- [ ] **Step 1: Update the existing test + add new ones** — in `libs/config/src/lib/config.spec.ts`, replace the `apiEnvSchema` describe block with:

```ts
describe('apiEnvSchema', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:18602/linkz',
    CLERK_SECRET_KEY: 'sk_test_x',
    STRIPE_SECRET_KEY: 'sk_stripe_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
  };
  it('parses a valid env with defaults', () => {
    const out = apiEnvSchema.parse(base);
    expect(out.PORT).toBe(18600);
    expect(out.CORS_ORIGIN).toBe('http://localhost:18601');
    expect(out.NODE_ENV).toBe('development');
    expect(out.SEAT_PRICE_AMOUNT).toBe(5000);
    expect(out.SEAT_PRICE_CURRENCY).toBe('usd');
    expect(out.STRIPE_SUCCESS_URL).toBe('http://localhost:18601/checkout/success');
  });
  it('rejects missing DATABASE_URL', () => {
    const { DATABASE_URL: _omit, ...rest } = base;
    expect(() => apiEnvSchema.parse(rest)).toThrow();
  });
  it('rejects missing CLERK_SECRET_KEY', () => {
    const { CLERK_SECRET_KEY: _omit, ...rest } = base;
    expect(() => apiEnvSchema.parse(rest)).toThrow();
  });
  it('rejects missing STRIPE_SECRET_KEY', () => {
    const { STRIPE_SECRET_KEY: _omit, ...rest } = base;
    expect(() => apiEnvSchema.parse(rest)).toThrow();
  });
  it('rejects missing STRIPE_WEBHOOK_SECRET', () => {
    const { STRIPE_WEBHOOK_SECRET: _omit, ...rest } = base;
    expect(() => apiEnvSchema.parse(rest)).toThrow();
  });
  it('coerces SEAT_PRICE_AMOUNT from a string', () => {
    expect(apiEnvSchema.parse({ ...base, SEAT_PRICE_AMOUNT: '7500' }).SEAT_PRICE_AMOUNT).toBe(7500);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm nx run config:test`
Expected: FAIL (Stripe fields not in schema; `SEAT_PRICE_AMOUNT` undefined).

- [ ] **Step 3: Implement** — in `libs/config/src/lib/config.ts`, add these fields to the `apiEnvSchema` object (after `CLERK_AUTHORIZED_PARTIES`):

```ts
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_SUCCESS_URL: z.string().url().default('http://localhost:18601/checkout/success'),
  STRIPE_CANCEL_URL: z.string().url().default('http://localhost:18601/checkout/cancel'),
  SEAT_PRICE_AMOUNT: z.coerce.number().int().positive().default(5000),
  SEAT_PRICE_CURRENCY: z.string().min(1).default('usd'),
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm nx run config:test`
Expected: PASS.

- [ ] **Step 5: Update `.env.example`** — add under the API section:

```
# Stripe
STRIPE_SECRET_KEY=sk_test_replace_me
STRIPE_WEBHOOK_SECRET=whsec_replace_me
STRIPE_SUCCESS_URL=http://localhost:18601/checkout/success
STRIPE_CANCEL_URL=http://localhost:18601/checkout/cancel
SEAT_PRICE_AMOUNT=5000
SEAT_PRICE_CURRENCY=usd
```

- [ ] **Step 6: Commit**

```bash
git add libs/config .env.example && git commit -m "feat(config): stripe + seat-price env on apiEnvSchema

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Payments ports & domain

**Files:**
- Create: `apps/api/src/payments/payments.ports.ts`, `apps/api/src/payments/payments.domain.ts`
- Test: `apps/api/src/payments/payments.domain.spec.ts`

**Interfaces:**
- Produces (ports): types `PaymentStatus`, `PaymentOutcome` (`'succeeded'|'failed'|'ignore'`), `ProviderEvent`, `PaymentRow`, `NewPayment`; interfaces `PaymentProviderPort` (`createCheckoutSession`, `constructEvent`), `PaymentsRepositoryPort` (`findByReservation`, `insertPending`, `settle`); DI tokens `PAYMENT_PROVIDER`, `PAYMENTS_REPOSITORY`, `PAYMENT_PRICE`; type `PaymentPrice` (`{ amount: number; currency: string }`).
- Produces (domain): `authorizeCreatePayment(reservationId, clerkUserId) => boolean`; `mapEvent(event: ProviderEvent) => PaymentOutcome`.

- [ ] **Step 1: Create the ports file** — `apps/api/src/payments/payments.ports.ts` (type/declaration scaffolding for later tasks; no test of its own):

```ts
export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'refunded';
export type PaymentOutcome = 'succeeded' | 'failed' | 'ignore';

// Provider-agnostic, normalized webhook event (Stripe specifics live in the adapter).
export interface ProviderEvent {
  id: string;
  type: string;
  paymentId: string | null; // from provider metadata
  isPaid: boolean; // session payment_status === 'paid'
  raw: unknown; // original event, stored in the ledger payload
}

export interface PaymentRow {
  id: string;
  reservationId: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  idempotencyKey: string;
  providerRef: string | null;
}

export interface NewPayment {
  reservationId: string;
  provider: string;
  providerRef: string | null;
  idempotencyKey: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
}

export interface PaymentProviderPort {
  createCheckoutSession(input: {
    paymentId: string;
    reservationId: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ providerRef: string; checkoutUrl: string }>;
  constructEvent(rawBody: Buffer | string, signature: string): ProviderEvent;
}

export interface PaymentsRepositoryPort {
  findByReservation(reservationId: string): Promise<PaymentRow | null>;
  insertPending(input: NewPayment): Promise<PaymentRow>;
  settle(paymentId: string, outcome: 'succeeded' | 'failed', event: ProviderEvent): Promise<void>;
}

export interface PaymentPrice {
  amount: number;
  currency: string;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
export const PAYMENTS_REPOSITORY = Symbol('PAYMENTS_REPOSITORY');
export const PAYMENT_PRICE = Symbol('PAYMENT_PRICE');
```

- [ ] **Step 2: Write failing tests** — `apps/api/src/payments/payments.domain.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { authorizeCreatePayment, mapEvent } from './payments.domain';
import type { ProviderEvent } from './payments.ports';

const ev = (over: Partial<ProviderEvent>): ProviderEvent => ({
  id: 'evt_1', type: 'checkout.session.completed', paymentId: 'p1', isPaid: true, raw: {}, ...over,
});

describe('authorizeCreatePayment', () => {
  it('returns true (stub)', () => {
    expect(authorizeCreatePayment('res-1', 'user_1')).toBe(true);
  });
});

describe('mapEvent', () => {
  it('paid checkout session -> succeeded', () => {
    expect(mapEvent(ev({ type: 'checkout.session.completed', isPaid: true }))).toBe('succeeded');
  });
  it('unpaid checkout session -> ignore', () => {
    expect(mapEvent(ev({ type: 'checkout.session.completed', isPaid: false }))).toBe('ignore');
  });
  it('payment_intent.payment_failed -> failed', () => {
    expect(mapEvent(ev({ type: 'payment_intent.payment_failed', isPaid: false }))).toBe('failed');
  });
  it('unknown type -> ignore', () => {
    expect(mapEvent(ev({ type: 'invoice.created' }))).toBe('ignore');
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `pnpm nx run api:test`
Expected: FAIL (`./payments.domain` not found).

- [ ] **Step 4: Implement** — `apps/api/src/payments/payments.domain.ts`:

```ts
import type { ProviderEvent, PaymentOutcome } from './payments.ports';

// TODO: enforce the real authorization once the reservations module exists:
// map the Clerk subject (clerkUserId) -> users.external_id -> reservations.user_id,
// require the reservation to exist, belong to the caller, be in status 'held',
// and have no active payment. Returns true unconditionally for now so the
// create-payment seam is in place without the reservations module.
export function authorizeCreatePayment(_reservationId: string, _clerkUserId: string): boolean {
  return true;
}

export function mapEvent(event: ProviderEvent): PaymentOutcome {
  if (event.type === 'checkout.session.completed' && event.isPaid) return 'succeeded';
  if (event.type === 'payment_intent.payment_failed') return 'failed';
  return 'ignore';
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm nx run api:test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/payments && git commit -m "feat(api): payments ports + domain (authorize stub, mapEvent)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Zod validation pipe

**Files:**
- Create: `apps/api/src/common/zod-validation.pipe.ts`
- Test: `apps/api/src/common/zod-validation.pipe.spec.ts`

**Interfaces:**
- Produces: `ZodValidationPipe<T>` — `new ZodValidationPipe(schema).transform(value) => T`; throws `BadRequestException` on invalid input.

- [ ] **Step 1: Write failing tests** — `apps/api/src/common/zod-validation.pipe.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

const schema = z.object({ name: z.string().min(1) });

describe('ZodValidationPipe', () => {
  it('returns parsed data for valid input', () => {
    const pipe = new ZodValidationPipe(schema);
    expect(pipe.transform({ name: 'ok' })).toEqual({ name: 'ok' });
  });
  it('throws BadRequestException for invalid input', () => {
    const pipe = new ZodValidationPipe(schema);
    expect(() => pipe.transform({ name: '' })).toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm nx run api:test`
Expected: FAIL (`./zod-validation.pipe` not found).

- [ ] **Step 3: Implement** — `apps/api/src/common/zod-validation.pipe.ts`:

```ts
import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import type { ZodType } from 'zod';

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.issues);
    }
    return result.data;
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm nx run api:test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common && git commit -m "feat(api): reusable zod validation pipe

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Stripe provider adapter

**Files:**
- Create: `apps/api/src/payments/adapters/stripe.payment-provider.ts`
- Test: `apps/api/src/payments/adapters/stripe.payment-provider.spec.ts`
- Modify: `apps/api/package.json` (add `stripe`)

**Interfaces:**
- Consumes: `PaymentProviderPort`, `ProviderEvent` (Task 3); `ConfigService` (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL`).
- Produces: `StripePaymentProvider implements PaymentProviderPort`.

- [ ] **Step 1: Install the SDK**

Run: `pnpm add stripe --filter api`
Expected: `stripe` added to `apps/api/package.json` dependencies.

- [ ] **Step 2: Write failing tests** — `apps/api/src/payments/adapters/stripe.payment-provider.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';

const sessionsCreate = vi.fn();
const constructEvent = vi.fn();
vi.mock('stripe', () => ({
  default: vi.fn(() => ({
    checkout: { sessions: { create: sessionsCreate } },
    webhooks: { constructEvent },
  })),
}));

import { StripePaymentProvider } from './stripe.payment-provider';

const config = {
  get: (k: string) =>
    ({
      STRIPE_SECRET_KEY: 'sk_x',
      STRIPE_WEBHOOK_SECRET: 'whsec_x',
      STRIPE_SUCCESS_URL: 'https://app/success',
      STRIPE_CANCEL_URL: 'https://app/cancel',
    })[k],
} as unknown as import('@nestjs/config').ConfigService;

describe('StripePaymentProvider.createCheckoutSession', () => {
  beforeEach(() => sessionsCreate.mockReset());
  it('creates a one-off session with metadata + idempotency key', async () => {
    sessionsCreate.mockResolvedValue({ id: 'cs_1', url: 'https://stripe/cs_1' });
    const provider = new StripePaymentProvider(config);
    const out = await provider.createCheckoutSession({
      paymentId: 'p1', reservationId: 'r1', amount: 5000, currency: 'usd', idempotencyKey: 'pay_r1',
    });
    expect(out).toEqual({ providerRef: 'cs_1', checkoutUrl: 'https://stripe/cs_1' });
    const [params, opts] = sessionsCreate.mock.calls[0];
    expect(params.mode).toBe('payment');
    expect(params.metadata).toEqual({ paymentId: 'p1', reservationId: 'r1' });
    expect(params.line_items[0].price_data).toMatchObject({ currency: 'usd', unit_amount: 5000 });
    expect(opts).toEqual({ idempotencyKey: 'pay_r1' });
  });
  it('throws when Stripe returns no url', async () => {
    sessionsCreate.mockResolvedValue({ id: 'cs_1', url: null });
    const provider = new StripePaymentProvider(config);
    await expect(
      provider.createCheckoutSession({ paymentId: 'p1', reservationId: 'r1', amount: 1, currency: 'usd', idempotencyKey: 'k' }),
    ).rejects.toThrow();
  });
});

describe('StripePaymentProvider.constructEvent', () => {
  beforeEach(() => constructEvent.mockReset());
  it('normalizes a paid checkout.session.completed', () => {
    constructEvent.mockReturnValue({
      id: 'evt_1', type: 'checkout.session.completed',
      data: { object: { metadata: { paymentId: 'p1' }, payment_status: 'paid' } },
    });
    const provider = new StripePaymentProvider(config);
    const e = provider.constructEvent(Buffer.from('{}'), 'sig');
    expect(e).toMatchObject({ id: 'evt_1', type: 'checkout.session.completed', paymentId: 'p1', isPaid: true });
  });
  it('throws BadRequestException on bad signature', () => {
    constructEvent.mockImplementation(() => { throw new Error('bad sig'); });
    const provider = new StripePaymentProvider(config);
    expect(() => provider.constructEvent(Buffer.from('{}'), 'sig')).toThrow(BadRequestException);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `pnpm nx run api:test`
Expected: FAIL (`./stripe.payment-provider` not found).

- [ ] **Step 4: Implement** — `apps/api/src/payments/adapters/stripe.payment-provider.ts`:

```ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { PaymentProviderPort, ProviderEvent } from '../payments.ports';

@Injectable()
export class StripePaymentProvider implements PaymentProviderPort {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;
  private readonly successUrl: string;
  private readonly cancelUrl: string;

  constructor(config: ConfigService) {
    this.stripe = new Stripe(config.get<string>('STRIPE_SECRET_KEY') ?? '');
    this.webhookSecret = config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    this.successUrl = config.get<string>('STRIPE_SUCCESS_URL') ?? '';
    this.cancelUrl = config.get<string>('STRIPE_CANCEL_URL') ?? '';
  }

  async createCheckoutSession(input: {
    paymentId: string;
    reservationId: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ providerRef: string; checkoutUrl: string }> {
    const metadata = { paymentId: input.paymentId, reservationId: input.reservationId };
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency,
              unit_amount: input.amount,
              product_data: { name: 'Seat reservation' },
            },
          },
        ],
        success_url: this.successUrl,
        cancel_url: this.cancelUrl,
        metadata,
        payment_intent_data: { metadata },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    if (!session.url) throw new Error('Stripe did not return a checkout url');
    return { providerRef: session.id, checkoutUrl: session.url };
  }

  constructEvent(rawBody: Buffer | string, signature: string): ProviderEvent {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }
    const obj = event.data.object as unknown as {
      metadata?: Record<string, string>;
      payment_status?: string;
    };
    return {
      id: event.id,
      type: event.type,
      paymentId: obj.metadata?.paymentId ?? null,
      isPaid: obj.payment_status === 'paid',
      raw: event,
    };
  }
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm nx run api:test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api package.json pnpm-lock.yaml pnpm-workspace.yaml && git commit -m "feat(api): stripe payment provider adapter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Drizzle payments repository adapter

**Files:**
- Modify: `libs/database/src/index.ts` (re-export tables), `apps/api/package.json` (add `drizzle-orm`)
- Create: `apps/api/src/payments/adapters/drizzle.payments.repository.ts`
- Test: `apps/api/src/payments/adapters/drizzle.payments.repository.spec.ts`

**Interfaces:**
- Consumes: `PaymentsRepositoryPort`, `PaymentRow`, `NewPayment`, `ProviderEvent` (Task 3); `DrizzleService` (`apps/api/src/drizzle/drizzle.service.ts`, exposes `.db`); tables `payments`, `webhookEvents`, `outbox` from `@linkz/database`.
- Produces: `DrizzlePaymentsRepository implements PaymentsRepositoryPort`.

- [ ] **Step 1: Re-export tables from `@linkz/database`** — append to `libs/database/src/index.ts`:

```ts
export * from './lib/schema/index.js';
```

- [ ] **Step 2: Add drizzle-orm to the api project**

Run: `pnpm add drizzle-orm --filter api`
Expected: `drizzle-orm` in `apps/api/package.json` (explicit; the adapter imports `eq`).

- [ ] **Step 3: Write the failing integration test** — `apps/api/src/payments/adapters/drizzle.payments.repository.spec.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, users, seats, reservations, payments, outbox } from '@linkz/database';
import type { DrizzleService } from '../../drizzle/drizzle.service';
import { DrizzlePaymentsRepository } from './drizzle.payments.repository';
import type { ProviderEvent } from '../payments.ports';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip; // integration: needs Postgres on 18602

class Rollback extends Error {}

d('DrizzlePaymentsRepository (integration, tx-rollback)', () => {
  const { db, client } = createDb(url as string);
  afterAll(async () => { await client.end({ timeout: 5 }); });

  it('insertPending then settle: marks succeeded + writes one outbox event (idempotent)', async () => {
    const u = `ext_${Date.now()}`;
    await db
      .transaction(async (tx) => {
        const [user] = await tx.insert(users).values({ externalId: u, email: `${u}@t.co` }).returning();
        const [seat] = await tx.insert(seats).values({ label: `L_${u}` }).returning();
        const [res] = await tx
          .insert(reservations)
          .values({ seatId: seat.id, userId: user.id, status: 'held', sagaStep: 'createPayment' })
          .returning();

        const repo = new DrizzlePaymentsRepository({ db: tx } as unknown as DrizzleService);
        const pay = await repo.insertPending({
          reservationId: res.id, provider: 'stripe', providerRef: null,
          idempotencyKey: `pay_${res.id}`, amount: 5000, currency: 'usd', status: 'pending',
        });
        expect(pay.status).toBe('pending');

        const event: ProviderEvent = { id: `evt_${u}`, type: 'checkout.session.completed', paymentId: pay.id, isPaid: true, raw: {} };
        await repo.settle(pay.id, 'succeeded', event);

        const [after] = await tx.select().from(payments).where(eq(payments.id, pay.id));
        expect(after.status).toBe('succeeded');

        const ob = await tx.select().from(outbox).where(eq(outbox.aggregateId, res.id));
        expect(ob).toHaveLength(1);
        expect(ob[0].type).toBe('payment.succeeded');

        // same event again -> deduped, no second outbox row
        await repo.settle(pay.id, 'succeeded', event);
        const ob2 = await tx.select().from(outbox).where(eq(outbox.aggregateId, res.id));
        expect(ob2).toHaveLength(1);

        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });
});
```

- [ ] **Step 4: Run — expect FAIL**

Run: `DATABASE_URL=postgres://linkz:linkz@localhost:18602/linkz pnpm nx run api:test`
Expected: FAIL (`./drizzle.payments.repository` not found). (Postgres must be up: `docker compose up -d`.)

- [ ] **Step 5: Implement** — `apps/api/src/payments/adapters/drizzle.payments.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { payments, webhookEvents, outbox } from '@linkz/database';
import { DrizzleService } from '../../drizzle/drizzle.service';
import type { PaymentsRepositoryPort, PaymentRow, NewPayment, ProviderEvent } from '../payments.ports';

@Injectable()
export class DrizzlePaymentsRepository implements PaymentsRepositoryPort {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  async findByReservation(reservationId: string): Promise<PaymentRow | null> {
    const [row] = await this.db.select().from(payments).where(eq(payments.reservationId, reservationId));
    return row ? this.toRow(row) : null;
  }

  async insertPending(input: NewPayment): Promise<PaymentRow> {
    const [row] = await this.db
      .insert(payments)
      .values({
        reservationId: input.reservationId,
        provider: input.provider,
        providerRef: input.providerRef,
        idempotencyKey: input.idempotencyKey,
        amount: input.amount,
        currency: input.currency,
        status: input.status,
      })
      .returning();
    return this.toRow(row);
  }

  async settle(paymentId: string, outcome: 'succeeded' | 'failed', event: ProviderEvent): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Exactly-once: ledger insert + settlement are atomic. Duplicate event -> no-op.
      const led = await tx
        .insert(webhookEvents)
        .values({
          eventId: event.id,
          type: event.type,
          payload: event.raw,
          status: 'processed',
          processedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ eventId: webhookEvents.eventId });
      if (led.length === 0) return; // already processed

      const [pay] = await tx
        .update(payments)
        .set({ status: outcome, updatedAt: new Date() })
        .where(eq(payments.id, paymentId))
        .returning();
      if (!pay) return; // unknown payment id

      await tx.insert(outbox).values({
        aggregateType: 'reservation',
        aggregateId: pay.reservationId,
        type: `payment.${outcome}`,
        payload: { paymentId, reservationId: pay.reservationId },
        status: 'pending',
      });
    });
  }

  private toRow(row: typeof payments.$inferSelect): PaymentRow {
    return {
      id: row.id,
      reservationId: row.reservationId,
      status: row.status,
      amount: row.amount,
      currency: row.currency,
      idempotencyKey: row.idempotencyKey,
      providerRef: row.providerRef,
    };
  }
}
```

- [ ] **Step 6: Run — expect PASS**

Run: `DATABASE_URL=postgres://linkz:linkz@localhost:18602/linkz pnpm nx run api:test`
Expected: PASS (integration test green; rolls back, no data persists).

- [ ] **Step 7: Commit**

```bash
git add apps/api libs/database package.json pnpm-lock.yaml && git commit -m "feat(api): drizzle payments repository (insert + atomic settle)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Payments service (use-cases)

**Files:**
- Create: `apps/api/src/payments/payments.service.ts`
- Test: `apps/api/src/payments/payments.service.spec.ts`

**Interfaces:**
- Consumes: `PaymentProviderPort`, `PaymentsRepositoryPort`, `PaymentPrice` (Task 3); `authorizeCreatePayment`, `mapEvent` (Task 3).
- Produces: `PaymentsService` with `createPayment(reservationId, clerkUserId) => Promise<{ paymentId; checkoutUrl }>` and `handleWebhook(rawBody, signature) => Promise<void>`.

- [ ] **Step 1: Write failing tests** — `apps/api/src/payments/payments.service.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import type { PaymentProviderPort, PaymentsRepositoryPort, PaymentRow, ProviderEvent } from './payments.ports';

const price = { amount: 5000, currency: 'usd' };
const pending = (over: Partial<PaymentRow> = {}): PaymentRow => ({
  id: 'p1', reservationId: 'r1', status: 'pending', amount: 5000, currency: 'usd', idempotencyKey: 'pay_r1', providerRef: null, ...over,
});

const makeProvider = (): PaymentProviderPort => ({
  createCheckoutSession: vi.fn().mockResolvedValue({ providerRef: 'cs_1', checkoutUrl: 'https://stripe/cs_1' }),
  constructEvent: vi.fn(),
});
const makeRepo = (): PaymentsRepositoryPort => ({
  findByReservation: vi.fn().mockResolvedValue(null),
  insertPending: vi.fn().mockResolvedValue(pending()),
  settle: vi.fn().mockResolvedValue(undefined),
});

describe('PaymentsService.createPayment', () => {
  let provider: PaymentProviderPort, repo: PaymentsRepositoryPort, svc: PaymentsService;
  beforeEach(() => { provider = makeProvider(); repo = makeRepo(); svc = new PaymentsService(provider, repo, price); });

  it('inserts a pending payment and returns the checkout url', async () => {
    const out = await svc.createPayment('r1', 'user_1');
    expect(repo.insertPending).toHaveBeenCalledWith(expect.objectContaining({ reservationId: 'r1', amount: 5000, currency: 'usd', idempotencyKey: 'pay_r1', status: 'pending' }));
    expect(provider.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'p1', reservationId: 'r1', idempotencyKey: 'pay_r1' }));
    expect(out).toEqual({ paymentId: 'p1', checkoutUrl: 'https://stripe/cs_1' });
  });

  it('reuses an existing pending payment (no duplicate insert)', async () => {
    repo.findByReservation = vi.fn().mockResolvedValue(pending({ id: 'p9', idempotencyKey: 'pay_r1' }));
    const out = await svc.createPayment('r1', 'user_1');
    expect(repo.insertPending).not.toHaveBeenCalled();
    expect(provider.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'p9', idempotencyKey: 'pay_r1' }));
    expect(out.paymentId).toBe('p9');
  });

  it('throws Conflict when the reservation is already paid', async () => {
    repo.findByReservation = vi.fn().mockResolvedValue(pending({ status: 'succeeded' }));
    await expect(svc.createPayment('r1', 'user_1')).rejects.toThrow(ConflictException);
  });
});

describe('PaymentsService.handleWebhook', () => {
  let provider: PaymentProviderPort, repo: PaymentsRepositoryPort, svc: PaymentsService;
  const event = (over: Partial<ProviderEvent>): ProviderEvent => ({ id: 'evt_1', type: 'checkout.session.completed', paymentId: 'p1', isPaid: true, raw: {}, ...over });
  beforeEach(() => { provider = makeProvider(); repo = makeRepo(); svc = new PaymentsService(provider, repo, price); });

  it('settles succeeded on a paid checkout session', async () => {
    provider.constructEvent = vi.fn().mockReturnValue(event({}));
    await svc.handleWebhook(Buffer.from('{}'), 'sig');
    expect(repo.settle).toHaveBeenCalledWith('p1', 'succeeded', expect.objectContaining({ id: 'evt_1' }));
  });
  it('settles failed on payment_intent.payment_failed', async () => {
    provider.constructEvent = vi.fn().mockReturnValue(event({ type: 'payment_intent.payment_failed', isPaid: false }));
    await svc.handleWebhook(Buffer.from('{}'), 'sig');
    expect(repo.settle).toHaveBeenCalledWith('p1', 'failed', expect.anything());
  });
  it('ignores unrelated events (no settle)', async () => {
    provider.constructEvent = vi.fn().mockReturnValue(event({ type: 'invoice.created', isPaid: false }));
    await svc.handleWebhook(Buffer.from('{}'), 'sig');
    expect(repo.settle).not.toHaveBeenCalled();
  });
  it('does not settle when the event has no paymentId', async () => {
    provider.constructEvent = vi.fn().mockReturnValue(event({ paymentId: null }));
    await svc.handleWebhook(Buffer.from('{}'), 'sig');
    expect(repo.settle).not.toHaveBeenCalled();
  });
  it('propagates signature errors from the provider', async () => {
    provider.constructEvent = vi.fn().mockImplementation(() => { throw new Error('bad sig'); });
    await expect(svc.handleWebhook(Buffer.from('{}'), 'sig')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm nx run api:test`
Expected: FAIL (`./payments.service` not found).

- [ ] **Step 3: Implement** — `apps/api/src/payments/payments.service.ts`:

```ts
import { Inject, Injectable, ConflictException } from '@nestjs/common';
import { authorizeCreatePayment, mapEvent } from './payments.domain';
import {
  PAYMENT_PROVIDER,
  PAYMENTS_REPOSITORY,
  PAYMENT_PRICE,
  type PaymentProviderPort,
  type PaymentsRepositoryPort,
  type PaymentPrice,
  type PaymentRow,
} from './payments.ports';

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProviderPort,
    @Inject(PAYMENTS_REPOSITORY) private readonly repo: PaymentsRepositoryPort,
    @Inject(PAYMENT_PRICE) private readonly price: PaymentPrice,
  ) {}

  async createPayment(reservationId: string, clerkUserId: string): Promise<{ paymentId: string; checkoutUrl: string }> {
    authorizeCreatePayment(reservationId, clerkUserId); // stub: always allowed (see TODO)

    const existing = await this.repo.findByReservation(reservationId);
    if (existing?.status === 'succeeded') {
      throw new ConflictException('Reservation already paid');
    }

    const idempotencyKey = `pay_${reservationId}`;
    const payment: PaymentRow =
      existing ??
      (await this.repo.insertPending({
        reservationId,
        provider: 'stripe',
        providerRef: null,
        idempotencyKey,
        amount: this.price.amount,
        currency: this.price.currency,
        status: 'pending',
      }));

    const { checkoutUrl } = await this.provider.createCheckoutSession({
      paymentId: payment.id,
      reservationId,
      amount: payment.amount,
      currency: payment.currency,
      idempotencyKey: payment.idempotencyKey,
    });

    return { paymentId: payment.id, checkoutUrl };
  }

  async handleWebhook(rawBody: Buffer | string, signature: string): Promise<void> {
    const event = this.provider.constructEvent(rawBody, signature); // throws BadRequest on bad sig
    const outcome = mapEvent(event);
    if (outcome === 'ignore' || !event.paymentId) return;
    await this.repo.settle(event.paymentId, outcome, event);
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm nx run api:test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/payments && git commit -m "feat(api): payments service (create + webhook use-cases)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Controller + module wiring + raw body

**Files:**
- Create: `apps/api/src/payments/payments.controller.ts`, `apps/api/src/payments/payments.module.ts`
- Test: `apps/api/src/payments/payments.controller.spec.ts`
- Modify: `apps/api/src/app/app.module.ts`, `apps/api/src/main.ts`

**Interfaces:**
- Consumes: `PaymentsService` (Task 7), `ZodValidationPipe` (Task 4), `CreatePaymentRequestSchema` (`@linkz/shared`), `ClerkGuard` + `AuthenticatedRequest` (`apps/api/src/clerk/clerk.guard.ts`), DI tokens + adapters (Tasks 3/5/6), `ConfigService`.
- Produces: `PaymentsController`, `PaymentsModule`.

- [ ] **Step 1: Write failing controller tests** — `apps/api/src/payments/payments.controller.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import type { PaymentsService } from './payments.service';

const svc = (over: Partial<PaymentsService> = {}): PaymentsService =>
  ({ createPayment: vi.fn(), handleWebhook: vi.fn(), ...over }) as unknown as PaymentsService;

describe('PaymentsController.create', () => {
  it('delegates to the service with reservationId + clerk user', async () => {
    const service = svc({ createPayment: vi.fn().mockResolvedValue({ paymentId: 'p1', checkoutUrl: 'u' }) });
    const ctrl = new PaymentsController(service);
    const out = await ctrl.create({ reservationId: 'r1' }, { user: 'user_1' } as never);
    expect(service.createPayment).toHaveBeenCalledWith('r1', 'user_1');
    expect(out).toEqual({ paymentId: 'p1', checkoutUrl: 'u' });
  });
});

describe('PaymentsController.webhook', () => {
  it('passes raw body + signature to the service and acks', async () => {
    const service = svc({ handleWebhook: vi.fn().mockResolvedValue(undefined) });
    const ctrl = new PaymentsController(service);
    const out = await ctrl.webhook({ rawBody: Buffer.from('{}') } as never, 'sig');
    expect(service.handleWebhook).toHaveBeenCalledWith(Buffer.from('{}'), 'sig');
    expect(out).toEqual({ received: true });
  });
  it('rejects when the raw body is missing', async () => {
    const ctrl = new PaymentsController(svc());
    await expect(ctrl.webhook({} as never, 'sig')).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm nx run api:test`
Expected: FAIL (`./payments.controller` not found).

- [ ] **Step 3: Implement the controller** — `apps/api/src/payments/payments.controller.ts`:

```ts
import { Body, Controller, Headers, Post, Req, UseGuards, BadRequestException, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { CreatePaymentRequestSchema, type CreatePaymentRequest } from '@linkz/shared';
import { ClerkGuard, type AuthenticatedRequest } from '../clerk/clerk.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Post()
  @UseGuards(ClerkGuard)
  async create(
    @Body(new ZodValidationPipe(CreatePaymentRequestSchema)) body: CreatePaymentRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.createPayment(body.reservationId, req.user as string);
  }

  @Post('webhook')
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature: string) {
    if (!req.rawBody) throw new BadRequestException('Missing raw body');
    await this.service.handleWebhook(req.rawBody, signature);
    return { received: true };
  }
}
```

- [ ] **Step 4: Implement the module** — `apps/api/src/payments/payments.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { ClerkModule } from '../clerk/clerk.module';
import { DrizzleService } from '../drizzle/drizzle.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripePaymentProvider } from './adapters/stripe.payment-provider';
import { DrizzlePaymentsRepository } from './adapters/drizzle.payments.repository';
import { PAYMENT_PROVIDER, PAYMENTS_REPOSITORY, PAYMENT_PRICE, type PaymentPrice } from './payments.ports';

@Module({
  imports: [DrizzleModule, ClerkModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    { provide: PAYMENT_PROVIDER, useClass: StripePaymentProvider },
    { provide: PAYMENTS_REPOSITORY, useClass: DrizzlePaymentsRepository },
    {
      provide: PAYMENT_PRICE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PaymentPrice => ({
        amount: config.get<number>('SEAT_PRICE_AMOUNT') ?? 5000,
        currency: config.get<string>('SEAT_PRICE_CURRENCY') ?? 'usd',
      }),
    },
    StripePaymentProvider,
    DrizzlePaymentsRepository,
  ],
})
export class PaymentsModule {}
```

- [ ] **Step 5: Register in `app.module.ts`** — add the import and module:

```ts
import { PaymentsModule } from '../payments/payments.module';
```
and add `PaymentsModule` to the `imports` array (after `DrizzleModule`).

- [ ] **Step 6: Enable raw body in `main.ts`** — change the factory line:

```ts
  const app = await NestFactory.create(AppModule, { rawBody: true });
```

- [ ] **Step 7: Run — expect PASS**

Run: `pnpm nx run api:test`
Expected: PASS (all payment specs green).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src && git commit -m "feat(api): payments controller + module + raw-body webhook

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Integration verification + final gates

- [ ] **Step 1: Postgres up**

```bash
docker compose up -d
for i in $(seq 1 30); do [ "$(docker compose ps --format '{{.Health}}' postgres)" = healthy ] && break; sleep 1; done
```

- [ ] **Step 2: Lint + test + build the api and libs**

```bash
pnpm nx run-many -t lint
DATABASE_URL=postgres://linkz:linkz@localhost:18602/linkz pnpm nx run-many -t test
pnpm nx run-many -t build
```
Expected: all PASS (0 lint errors; payments domain/service/provider/controller specs + repo integration test green).

- [ ] **Step 3: Boot the API with the new env and probe routes**

```bash
DATABASE_URL=postgres://linkz:linkz@localhost:18602/linkz \
CLERK_SECRET_KEY=sk_test_dummy STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy \
pnpm nx run api:serve > /tmp/api.serve.log 2>&1 &
for i in $(seq 1 45); do curl -sf http://localhost:18600/api/health >/dev/null 2>&1 && break; sleep 1; done
echo -n "health: " && curl -s http://localhost:18600/api/health
echo "" && echo -n "POST /api/payments (no token) -> " && curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:18600/api/payments
echo -n "POST /api/payments/webhook (no sig) -> " && curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:18600/api/payments/webhook -H 'content-type: application/json' -d '{}'
pkill -f "nx run api:serve" 2>/dev/null; pkill -f "node.*api/src/main" 2>/dev/null
```
Expected: `health: {"status":"ok"}`; `POST /api/payments` without a token → `401`; webhook without a valid signature → `400`.

- [ ] **Step 4: Final commit (if anything pending)**

```bash
git add -A && git commit -m "chore(api): verify payments module e2e (lint/test/build/serve)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" || echo "nothing to commit"
```

---

## Self-Review notes

- **Spec coverage:** Checkout Session create (Tasks 5/7/8) ✓; signed webhook verify + exactly-once ledger + outbox seam (Tasks 5/6/7) ✓; authorize stub with TODO (Task 3) ✓; config/price from env (Task 2) ✓; shared schemas (Task 1) ✓; no schema changes (reuses tables; Task 6 only re-exports) ✓; invariants honored (bad sig→400, dedupe, succeed-only outbox, failed compensation) ✓.
- **No placeholders:** every code step shows full code; commands have expected output.
- **Type consistency:** `ProviderEvent`, `PaymentRow`, `NewPayment`, ports, and tokens defined in Task 3 are used unchanged in Tasks 5–8; `settle(paymentId, outcome, event)` signature consistent across repo/service/tests.
- **Risks:** (1) `payments.$inferSelect` requires the table re-export from Task 6 — ordered before the repo adapter. (2) The repo test is gated on `DATABASE_URL`; verification runs always set it. (3) Making Stripe keys required changes api boot env — covered in Task 2 (`.env.example`) and Task 9 (boot command).
```
