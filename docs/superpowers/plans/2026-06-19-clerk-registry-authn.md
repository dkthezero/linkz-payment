# Clerk Registry & Authn Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user signs in with Google via Clerk; on their first authenticated API call the API just-in-time provisions them into the `users` table (with a display name), and the resolved `AppUser` is attached to every protected request so `/api/me` returns `{ appUserId, clerkUserId, email, name }`.

**Architecture:** `@UseGuards(ClerkGuard, UserResolver)` on protected controllers. `ClerkGuard` verifies the Bearer JWT via `@clerk/backend` using config from `@linkz/config` (no `process.env`). `UserResolver` resolves the Clerk `sub` to an `AppUser` via a `UserRepository` port (Drizzle impl, `ON CONFLICT DO NOTHING` upsert) and, on first sight, fetches email+name from the Clerk Backend API. Hexagonal: the resolver depends on the port, not the concretion.

**Tech Stack:** NestJS 11 · `@clerk/backend` 3.7.1 (`verifyToken`, `createClerkClient`) · Drizzle 0.45 + postgres-js · `@linkz/shared` (Zod) · `@linkz/config` · SolidJS + `@clerk/clerk-js` · Vitest 4.1.9 · Nx 23 / pnpm 11.

## Global Constraints

- Work in the worktree at `/Users/dkthezero/Vault/projects/linkz/.claude/worktrees/clerk-registry-authn` (branch `feat/clerk-registry-authn`). Run every shell command `</dev/null` to avoid pnpm's interactive TTY stall.
- Run tasks through nx: `pnpm nx run <project>:<target>` / `pnpm nx run-many -t <target>`. Prefix with `pnpm`.
- TypeScript `strict`; no `any` (use `unknown` + narrow); no `!` non-null assertions (throw-or-narrow instead). Union literals over enums. Zod at boundaries; types via `z.infer`; schemas in `@linkz/shared`.
- NestJS: thin controllers; logic in services/guards; depend on injected ports, not concretions; one module per feature; config only through `@linkz/config`, never `process.env` in services.
- No password storage (auth delegated to Clerk). No new DB tables beyond the `name` column on `users`. Do NOT weaken the seat-concurrency / webhook-idempotency / saga invariants (untouched this feature).
- TDD per unit: write the failing test → run it red → implement → run it green → commit. Stage ONLY the paths each task lists (never `git add .` — there are parallel edits on `main` we must not bundle).
- Ports: 18600 (api), 18601 (web), 18602 (postgres). TS >=5.4.2 <5.10.0 (do not bump).

---

## File Structure

**Create:**
- `apps/api/src/clerk/clerk.config.ts` — `ClerkConfig` type, `CLERK_CONFIG` token, `clerkConfigProvider` factory (reads validated env via `ConfigService`).
- `apps/api/src/clerk/clerk.backend.ts` — `ClerkBackendService` (wraps `createClerkClient`); `getUserProfile(sub)`; `ClerkUserNotFoundError`.
- `apps/api/src/clerk/clerk.backend.spec.ts`
- `apps/api/src/users/user.repository.ts` — `UserRepository` port + `USER_REPOSITORY` token.
- `apps/api/src/users/drizzle-user.repository.ts` — Drizzle impl.
- `apps/api/src/users/drizzle-user.repository.spec.ts`
- `apps/api/src/users/user.resolver.ts` — `UserResolver` guard.
- `apps/api/src/users/user.resolver.spec.ts`
- `apps/api/src/users/users.module.ts` — wires port + impl + resolver.
- `libs/database/src/index.spec.ts` — asserts schema tables are exported from the package root.

**Modify:**
- `libs/database/src/lib/schema/users.ts` — add `name` column.
- `libs/database/src/lib/schema/schema.spec.ts` — expect `name`.
- `libs/database/src/index.ts` — `export * from './lib/schema'`.
- `libs/shared/src/lib/shared.ts` — add `AppUserSchema` (Task 3); change `MeResponseSchema` shape (Task 8).
- `libs/shared/src/lib/shared.spec.ts` — `AppUserSchema` tests (Task 3); `MeResponseSchema` test update (Task 8).
- `apps/api/src/clerk/clerk.guard.ts` — inject `CLERK_CONFIG`; set `clerkClaims`; extend `AuthenticatedRequest` with `clerkClaims` + `appUser`.
- `apps/api/src/clerk/clerk.guard.spec.ts` — construct guard with config; add "uses config not env".
- `apps/api/src/clerk/clerk.module.ts` — provide `CLERK_CONFIG`, `ClerkGuard`, `ClerkBackendService`.
- `apps/api/src/me/me.controller.ts` — `@UseGuards(ClerkGuard, UserResolver)`; return enriched body.
- `apps/api/src/me/me.controller.spec.ts` — enriched assertions.
- `apps/api/src/app/app.module.ts` — import `UsersModule`.
- `apps/api/package.json` — add `drizzle-orm` dep (Task 6).
- `apps/web/src/clerk/auth.ts` — `AuthState.name`; `deriveAuth` name; `fetchMe` returns local `MeResponse`.
- `apps/web/src/clerk/auth.spec.ts` — name + MeResponse assertions.
- `apps/web/src/App.tsx` — welcome shows `auth().name ?? auth().userId`.

**Generated:** `libs/database/drizzle/0001_*.sql` + `meta/_journal.json` + snapshot (Task 1, by `db-generate`).

---

## Task 1: Add `name` column to `users` + generate/apply migration

**Files:**
- Modify: `libs/database/src/lib/schema/users.ts`
- Modify: `libs/database/src/lib/schema/schema.spec.ts:40-54`
- Generate: `libs/database/drizzle/0001_*.sql` + meta

**Interfaces:**
- Produces: `users` table now has `name: varchar notNull`; `users.$inferSelect` includes `name: string`.

- [ ] **Step 1: Create the worktree `.env` (for `db-generate`/`db-migrate`)**

```bash
cd /Users/dkthezero/Vault/projects/linkz/.claude/worktrees/clerk-registry-authn
cp .env.example .env </dev/null
```

`.env.example` already has `DATABASE_URL=postgres://linkz:linkz@localhost:18602/linkz` and `CLERK_SECRET_KEY=sk_test_replace_me` — enough for migration. (`.env` is gitignored; do not commit it.)

- [ ] **Step 2: Write the failing test — update `schema.spec.ts` `users` describe**

Replace the `users` describe block (lines 40–54) with:

```ts
describe('users (identity mirror — no password)', () => {
  it('has the ERD columns + name, and no password column', () => {
    const c = cols(users);
    expect(getTableConfig(users).name).toBe('users');
    expect(Object.keys(c).sort()).toEqual(['created_at', 'email', 'external_id', 'id', 'name']);
    expect(c['password']).toBeUndefined();
  });
  it('enforces id PK, unique Clerk subject, required email + name + created_at default', () => {
    const c = cols(users);
    expect(c['id'].primary).toBe(true);
    expect(c['external_id']).toMatchObject({ notNull: true, isUnique: true });
    expect(c['email'].notNull).toBe(true);
    expect(c['name']).toMatchObject({ notNull: true });
    expect(c['created_at']).toMatchObject({ notNull: true, hasDefault: true });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm nx run database:test </dev/null 2>&1 | tail -15
```
Expected: FAIL — `expected ['created_at','email','external_id','id','name']` but received `[…, 'name']` absent (the `name` key check fails).

- [ ] **Step 4: Implement — add the `name` column**

Replace the contents of `libs/database/src/lib/schema/users.ts` with:

```ts
import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';

// Identity mirror — no password column (auth is delegated to Clerk).
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalId: varchar('external_id').notNull().unique(), // Clerk subject (sub)
  email: varchar('email').notNull(),
  name: varchar('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm nx run database:test </dev/null 2>&1 | tail -15
```
Expected: PASS — all database tests green (the `users` describe now matches).

- [ ] **Step 6: Generate the migration**

```bash
cd /Users/dkthezero/Vault/projects/linkz/.claude/worktrees/clerk-registry-authn
pnpm nx run database:db-generate </dev/null 2>&1 | tail -15
```
Expected: a new migration `libs/database/drizzle/0001_<name>.sql` containing `ALTER TABLE "users" ADD COLUMN "name" varchar NOT NULL;` plus updated `meta/_journal.json` and a new snapshot. (If `0000` was not yet applied, `db-generate` still only emits the delta vs the snapshot — it does not connect to the DB.)

- [ ] **Step 7: Apply migrations to the running Postgres**

```bash
docker compose up -d </dev/null 2>&1 | tail -3
for i in $(seq 1 30); do docker compose ps postgres 2>/dev/null | grep -q healthy && break; sleep 1; done
pnpm nx run database:db-migrate </dev/null 2>&1 | tail -15
```
Expected: `db-migrate` applies `0000` (if pending) then `0001` (adds `name`); exit 0. (Postgres is the shared docker container on host `:18602`.)

- [ ] **Step 8: Commit**

```bash
git add libs/database/src/lib/schema/users.ts libs/database/src/lib/schema/schema.spec.ts libs/database/drizzle
git commit -m "feat(database): add users.name column + migration 0001

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Export schema tables from `@linkz/database`

**Files:**
- Modify: `libs/database/src/index.ts`
- Create: `libs/database/src/index.spec.ts`

**Interfaces:**
- Produces: `import { users, webhookEvents } from '@linkz/database'` resolves (table objects), enabling the api's `DrizzleUserRepository` (Task 6) to import `users`.

- [ ] **Step 1: Write the failing test — `libs/database/src/index.spec.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createDb, getDb, users, webhookEvents } from './index';

describe('@linkz/database package root', () => {
  it('exports the db factory + singleton', () => {
    expect(typeof createDb).toBe('function');
    expect(typeof getDb).toBe('function');
  });
  it('exports the users + webhook_events tables', () => {
    expect(users).toBeDefined();
    expect(webhookEvents).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx run database:test </dev/null 2>&1 | tail -15
```
Expected: FAIL — `users` (and `webhookEvents`) is not exported from `./index` (import error / undefined).

- [ ] **Step 3: Implement — re-export the schema barrel**

Replace the contents of `libs/database/src/index.ts` with:

```ts
export { createDb, getDb } from './lib/client.js';
export type { DbClient } from './lib/client.js';
export * from './lib/schema';
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm nx run database:test </dev/null 2>&1 | tail -15
```
Expected: PASS — the new `index.spec.ts` plus existing `schema.spec.ts` all green.

- [ ] **Step 5: Commit**

```bash
git add libs/database/src/index.ts libs/database/src/index.spec.ts
git commit -m "feat(database): export schema tables from package root

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: `@linkz/shared` — add `AppUserSchema`

**Files:**
- Modify: `libs/shared/src/lib/shared.ts`
- Modify: `libs/shared/src/lib/shared.spec.ts`

**Interfaces:**
- Produces: `AppUserSchema` + `AppUser = z.infer<typeof AppUserSchema>` = `{ id: string(uuid); externalId: string; email: string; name: string }`. Consumed by `UserRepository` (Task 6), `UserResolver` (Task 7), `AuthenticatedRequest.appUser` (Task 4).

- [ ] **Step 1: Write the failing test — append to `shared.spec.ts`**

Add this import line to the top (merge with existing import):

```ts
import { HealthResponseSchema, MeResponseSchema, AppUserSchema } from './shared.js';
```

Append a new describe block:

```ts
describe('AppUserSchema', () => {
  const valid = { id: '550e8400-e29b-41d4-a716-446655440000', externalId: 'user_1', email: 'a@b.com', name: 'Alice' };
  it('parses a valid app user', () =>
    expect(AppUserSchema.parse(valid)).toEqual(valid));
  it('rejects a non-uuid id', () =>
    expect(() => AppUserSchema.parse({ ...valid, id: 'not-a-uuid' })).toThrow());
  it('rejects missing name', () =>
    expect(() => AppUserSchema.parse({ id: valid.id, externalId: 'user_1', email: 'a@b.com' })).toThrow());
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx run shared:test </dev/null 2>&1 | tail -15
```
Expected: FAIL — `AppUserSchema` is not exported from `./shared.js`.

- [ ] **Step 3: Implement — add `AppUserSchema`**

Replace the contents of `libs/shared/src/lib/shared.ts` with:

```ts
import { z } from 'zod';

export const HealthResponseSchema = z.object({ status: z.literal('ok') });
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const AppUserSchema = z.object({
  id: z.string().uuid(),
  externalId: z.string().min(1),
  email: z.string().min(1),
  name: z.string().min(1),
});
export type AppUser = z.infer<typeof AppUserSchema>;

export const MeResponseSchema = z.object({ clerkUserId: z.string().min(1) });
export type MeResponse = z.infer<typeof MeResponseSchema>;
```

(Leave `MeResponseSchema` as-is here; Task 8 changes its shape alongside the controller.)

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm nx run shared:test </dev/null 2>&1 | tail -15
```
Expected: PASS — `AppUserSchema` tests + existing tests green.

- [ ] **Step 5: Commit**

```bash
git add libs/shared/src/lib/shared.ts libs/shared/src/lib/shared.spec.ts
git commit -m "feat(shared): add AppUserSchema (registry entity)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: API `ClerkConfig` provider + refactor `ClerkGuard` (config injection)

**Files:**
- Create: `apps/api/src/clerk/clerk.config.ts`
- Modify: `apps/api/src/clerk/clerk.guard.ts`
- Modify: `apps/api/src/clerk/clerk.guard.spec.ts`
- Modify: `apps/api/src/clerk/clerk.module.ts`

**Interfaces:**
- Consumes: `@linkz/config`-validated env via NestJS `ConfigService` (`CLERK_SECRET_KEY`, `CLERK_JWT_KEY?`, `CLERK_AUTHORIZED_PARTIES`).
- Produces: `ClerkConfig = { secretKey: string; jwtKey?: string; authorizedParties: string[] }`; `CLERK_CONFIG` injection token; `clerkConfigProvider`. `ClerkGuard` constructor `new ClerkGuard(config: ClerkConfig)`. `AuthenticatedRequest` gains `clerkClaims?: { sub: string; sid?: string }` and `appUser?: AppUser` (set later by `UserResolver`).

- [ ] **Step 1: Write the failing test — replace `clerk.guard.spec.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { ClerkGuard } from './clerk.guard';
import type { ClerkConfig } from './clerk.config';

vi.mock('@clerk/backend', () => ({ verifyToken: vi.fn() }));
import { verifyToken } from '@clerk/backend';
const mockedVerify = vi.mocked(verifyToken);

const config: ClerkConfig = { secretKey: 'sk_test_x', authorizedParties: ['http://localhost:18601'] };

const makeCtx = (authHeader?: string): ExecutionContext => {
  const req: any = { headers: {} };
  if (authHeader !== undefined) req.headers.authorization = authHeader;
  return { switchToHttp: () => ({ getRequest: () => req }) } as any;
};

describe('ClerkGuard', () => {
  beforeEach(() => mockedVerify.mockClear());
  afterEach(() => { delete process.env.CLERK_SECRET_KEY; delete process.env.CLERK_JWT_KEY; });

  it('rejects missing Authorization header', async () => {
    await expect(new ClerkGuard(config).canActivate(makeCtx())).rejects.toThrow('Missing Bearer token');
  });
  it('rejects empty token', async () => {
    await expect(new ClerkGuard(config).canActivate(makeCtx('Bearer '))).rejects.toThrow('Empty Bearer token');
  });
  it('sets req.user + clerkClaims + allows on valid token', async () => {
    mockedVerify.mockResolvedValueOnce({ sub: 'user_123', sid: 'sess_1' } as any);
    const ctx = makeCtx('Bearer valid.jwt');
    await expect(new ClerkGuard(config).canActivate(ctx)).resolves.toBe(true);
    const req = ctx.switchToHttp().getRequest() as any;
    expect(req.user).toBe('user_123');
    expect(req.clerkClaims).toEqual({ sub: 'user_123', sid: 'sess_1' });
  });
  it('rejects when verifyToken throws', async () => {
    mockedVerify.mockRejectedValueOnce(new Error('bad'));
    await expect(new ClerkGuard(config).canActivate(makeCtx('Bearer bad'))).rejects.toThrow('Invalid or expired Clerk session token');
  });
  it('uses the injected config, not process.env', async () => {
    process.env.CLERK_SECRET_KEY = 'WRONG_FROM_ENV';
    process.env.CLERK_JWT_KEY = 'WRONG_JWT';
    mockedVerify.mockResolvedValueOnce({ sub: 'user_123', sid: 'sess_1' } as any);
    await new ClerkGuard(config).canActivate(makeCtx('Bearer valid.jwt'));
    expect(mockedVerify.mock.calls[0][1]).toMatchObject({
      secretKey: 'sk_test_x',
      authorizedParties: ['http://localhost:18601'],
    });
    expect(mockedVerify.mock.calls[0][1]).not.toMatchObject({ secretKey: 'WRONG_FROM_ENV' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx run api:test </dev/null 2>&1 | grep -E "ClerkGuard|FAIL|PASS|Test Files|Tests " | tail -10
```
Expected: FAIL — `clerk.config` module not found / `new ClerkGuard(config)` arity mismatch (guard has no constructor).

- [ ] **Step 3: Implement — create `clerk.config.ts`**

```ts
import { ConfigService } from '@nestjs/config';
import type { Provider } from '@nestjs/common';

export interface ClerkConfig {
  secretKey: string;
  jwtKey?: string;
  authorizedParties: string[];
}

export const CLERK_CONFIG = 'CLERK_CONFIG';

export const clerkConfigProvider: Provider = {
  provide: CLERK_CONFIG,
  useFactory: (config: ConfigService): ClerkConfig => {
    const secretKey = config.get<string>('CLERK_SECRET_KEY');
    if (!secretKey) throw new Error('CLERK_SECRET_KEY is not configured');
    const jwtKey = config.get<string>('CLERK_JWT_KEY') || undefined;
    const authorizedParties = (config.get<string>('CLERK_AUTHORIZED_PARTIES') ?? 'http://localhost:18601')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return { secretKey, jwtKey, authorizedParties };
  },
  inject: [ConfigService],
};
```

- [ ] **Step 4: Implement — refactor `clerk.guard.ts`**

```ts
import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import type { Request } from 'express';
import type { AppUser } from '@linkz/shared';
import { ClerkConfig, CLERK_CONFIG } from './clerk.config';

export interface AuthenticatedRequest extends Request {
  user?: string; // Clerk subject (sub)
  clerkSessionId?: string;
  clerkClaims?: { sub: string; sid?: string };
  appUser?: AppUser; // set by UserResolver
}

@Injectable()
export class ClerkGuard implements CanActivate {
  constructor(@Inject(CLERK_CONFIG) private readonly config: ClerkConfig) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing Bearer token');
    const token = header.slice('Bearer '.length).trim();
    if (!token) throw new UnauthorizedException('Empty Bearer token');
    try {
      const verified = await verifyToken(token, {
        secretKey: this.config.secretKey,
        jwtKey: this.config.jwtKey,
        authorizedParties: this.config.authorizedParties,
      });
      req.user = verified.sub;
      req.clerkSessionId = verified.sid;
      req.clerkClaims = { sub: verified.sub, sid: verified.sid };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired Clerk session token');
    }
  }
}
```

- [ ] **Step 5: Implement — update `clerk.module.ts` (CLERK_CONFIG provider; ClerkBackendService added in Task 5)**

```ts
import { Module } from '@nestjs/common';
import { ClerkGuard } from './clerk.guard';
import { clerkConfigProvider, CLERK_CONFIG } from './clerk.config';

@Module({
  providers: [clerkConfigProvider, ClerkGuard],
  exports: [ClerkGuard, CLERK_CONFIG],
})
export class ClerkModule {}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
pnpm nx run api:test </dev/null 2>&1 | grep -E "ClerkGuard|Test Files|Tests " | tail -10
```
Expected: PASS — all `ClerkGuard` tests green (5 tests) and the rest of the api suite still green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/clerk/clerk.config.ts apps/api/src/clerk/clerk.guard.ts apps/api/src/clerk/clerk.guard.spec.ts apps/api/src/clerk/clerk.module.ts
git commit -m "refactor(api): ClerkGuard reads @linkz/config via CLERK_CONFIG, not process.env

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: API `ClerkBackendService` (email + name from Clerk Backend API)

**Files:**
- Create: `apps/api/src/clerk/clerk.backend.ts`
- Create: `apps/api/src/clerk/clerk.backend.spec.ts`
- Modify: `apps/api/src/clerk/clerk.module.ts`

**Interfaces:**
- Consumes: `CLERK_CONFIG` (secretKey).
- Produces: `ClerkBackendService.getUserProfile(sub): Promise<{ email: string; name: string }>`; `ClerkUserNotFoundError` (thrown on 404). `name = firstName+lastName || username || email`. Consumed by `UserResolver` (Task 7).

- [ ] **Step 1: Write the failing test — `clerk.backend.spec.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/backend', () => ({ createClerkClient: vi.fn() }));
import { createClerkClient } from '@clerk/backend';
import { ClerkBackendService, ClerkUserNotFoundError } from './clerk.backend';

const mockUser = (overrides: Record<string, unknown> = {}) => ({
  firstName: 'Alice',
  lastName: 'Smith',
  username: 'alice',
  primaryEmailAddressId: 'e1',
  emailAddresses: [{ id: 'e1', emailAddress: 'alice@example.com' }],
  ...overrides,
});

const makeService = (getUser: ReturnType<typeof vi.fn>) => {
  vi.mocked(createClerkClient).mockReturnValue({ users: { getUser } } as any);
  return new ClerkBackendService({ secretKey: 'sk_x', authorizedParties: [] } as any);
};

describe('ClerkBackendService.getUserProfile', () => {
  beforeEach(() => vi.mocked(createClerkClient).mockClear());

  it('returns email + name from firstName/lastName', async () => {
    const getUser = vi.fn().mockResolvedValue(mockUser());
    const out = await makeService(getUser).getUserProfile('user_1');
    expect(out).toEqual({ email: 'alice@example.com', name: 'Alice Smith' });
    expect(getUser).toHaveBeenCalledWith('user_1');
  });
  it('falls back to username when no firstName/lastName', async () => {
    const getUser = vi.fn().mockResolvedValue(mockUser({ firstName: '', lastName: '' }));
    expect((await makeService(getUser).getUserProfile('user_1')).name).toBe('alice');
  });
  it('falls back to email when no name at all', async () => {
    const getUser = vi.fn().mockResolvedValue(mockUser({ firstName: '', lastName: '', username: '' }));
    expect((await makeService(getUser).getUserProfile('user_1')).name).toBe('alice@example.com');
  });
  it('throws ClerkUserNotFoundError on 404', async () => {
    const getUser = vi.fn().mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
    await expect(makeService(getUser).getUserProfile('user_1')).rejects.toBeInstanceOf(ClerkUserNotFoundError);
  });
  it('rethrows non-404 errors', async () => {
    const getUser = vi.fn().mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    await expect(makeService(getUser).getUserProfile('user_1')).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx run api:test </dev/null 2>&1 | grep -E "ClerkBackendService|Test Files|Tests " | tail -10
```
Expected: FAIL — `./clerk.backend` not found.

- [ ] **Step 3: Implement — create `clerk.backend.ts`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';
import { ClerkConfig, CLERK_CONFIG } from './clerk.config';

export class ClerkUserNotFoundError extends Error {
  constructor(public readonly sub: string) {
    super(`Clerk user not found: ${sub}`);
    this.name = 'ClerkUserNotFoundError';
  }
}

export interface ClerkUserProfile {
  email: string;
  name: string;
}

@Injectable()
export class ClerkBackendService {
  private readonly client: ReturnType<typeof createClerkClient>;

  constructor(@Inject(CLERK_CONFIG) config: ClerkConfig) {
    this.client = createClerkClient({ secretKey: config.secretKey });
  }

  async getUserProfile(sub: string): Promise<ClerkUserProfile> {
  let user;
    try {
      user = await this.client.users.getUser(sub);
    } catch (e) {
      if ((e as { status?: number })?.status === 404) throw new ClerkUserNotFoundError(sub);
      throw e;
    }
    const email =
      user.emailAddresses?.find((e: { id: string }) => e.id === user.primaryEmailAddressId)?.emailAddress ??
      user.emailAddresses?.[0]?.emailAddress;
    if (!email) throw new Error(`Clerk user ${sub} has no email address`);
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || email;
    return { email, name };
  }
}
```

- [ ] **Step 4: Implement — provide it in `clerk.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ClerkGuard } from './clerk.guard';
import { clerkConfigProvider, CLERK_CONFIG } from './clerk.config';
import { ClerkBackendService } from './clerk.backend';

@Module({
  providers: [clerkConfigProvider, ClerkGuard, ClerkBackendService],
  exports: [ClerkGuard, CLERK_CONFIG, ClerkBackendService],
})
export class ClerkModule {}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm nx run api:test </dev/null 2>&1 | grep -E "ClerkBackendService|Test Files|Tests " | tail -10
```
Expected: PASS — `ClerkBackendService` tests (5) green; whole api suite green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/clerk/clerk.backend.ts apps/api/src/clerk/clerk.backend.spec.ts apps/api/src/clerk/clerk.module.ts
git commit -m "feat(api): ClerkBackendService — fetch user email + name via createClerkClient

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: API `UserRepository` port + Drizzle impl + `UsersModule`

**Files:**
- Create: `apps/api/src/users/user.repository.ts`
- Create: `apps/api/src/users/drizzle-user.repository.ts`
- Create: `apps/api/src/users/drizzle-user.repository.spec.ts`
- Create: `apps/api/src/users/users.module.ts`
- Modify: `apps/api/package.json` (add `drizzle-orm` dep)

**Interfaces:**
- Consumes: `DrizzleService` (`db`), `users` table from `@linkz/database` (Task 2), `AppUser` from `@linkz/shared` (Task 3).
- Produces: `UserRepository` port `{ findByExternalId(externalId): Promise<AppUser | undefined>; upsert(externalId, email, name): Promise<AppUser> }`; `USER_REPOSITORY` token; `DrizzleUserRepository` impl; `UsersModule` exporting `USER_REPOSITORY`. Consumed by `UserResolver` (Task 7).

- [ ] **Step 1: Add `drizzle-orm` as an explicit api dependency**

```bash
cd /Users/dkthezero/Vault/projects/linkz/.claude/worktrees/clerk-registry-authn
pnpm add drizzle-orm -F api </dev/null 2>&1 | tail -8
pnpm dlx nx sync </dev/null 2>&1 | tail -3
```
Expected: `drizzle-orm` added to `apps/api/package.json` `dependencies` (resolves the existing `0.45.2` from the lockfile); `nx sync` confirms references up to date.

- [ ] **Step 2: Write the failing test — `drizzle-user.repository.spec.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { DrizzleUserRepository } from './drizzle-user.repository';

// Mock Drizzle's chained query builder. `select().from().where()` -> Promise<rows[]>;
// `insert().values().onConflictDoNothing()` -> Promise<void>.
const makeMockDrizzle = (rows: any[]) => {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });
  return { db: { select, insert } as any, _insert: insert, _onConflict: onConflictDoNothing };
};

const row = { id: 'u-1', externalId: 'ext1', email: 'a@b.com', name: 'Alice' };

describe('DrizzleUserRepository', () => {
  it('findByExternalId returns AppUser when found', async () => {
    const m = makeMockDrizzle([row]);
    const repo = new DrizzleUserRepository(m as any);
    expect(await repo.findByExternalId('ext1')).toEqual(row);
  });
  it('findByExternalId returns undefined when not found', async () => {
    const m = makeMockDrizzle([]);
    expect(await new DrizzleUserRepository(m as any).findByExternalId('ext1')).toBeUndefined();
  });
  it('upsert inserts on-conflict-do-nothing then re-selects the row', async () => {
    const m = makeMockDrizzle([row]);
    const repo = new DrizzleUserRepository(m as any);
    const out = await repo.upsert('ext1', 'a@b.com', 'Alice');
    expect(out).toEqual(row);
    expect(m._insert).toHaveBeenCalled();
    expect(m._onConflictDoNothing).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm nx run api:test </dev/null 2>&1 | grep -E "DrizzleUserRepository|Test Files|Tests " | tail -10
```
Expected: FAIL — `./drizzle-user.repository` not found.

- [ ] **Step 4: Implement — create `user.repository.ts` (port)**

```ts
import type { AppUser } from '@linkz/shared';

export interface UserRepository {
  findByExternalId(externalId: string): Promise<AppUser | undefined>;
  upsert(externalId: string, email: string, name: string): Promise<AppUser>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
```

- [ ] **Step 5: Implement — create `drizzle-user.repository.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { users } from '@linkz/database';
import type { AppUser } from '@linkz/shared';
import { DrizzleService } from '../drizzle/drizzle.service';
import type { UserRepository } from './user.repository';

const toAppUser = (row: typeof users.$inferSelect): AppUser => ({
  id: row.id,
  externalId: row.externalId,
  email: row.email,
  name: row.name,
});

@Injectable()
export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findByExternalId(externalId: string): Promise<AppUser | undefined> {
    const rows = await this.drizzle.db.select().from(users).where(eq(users.externalId, externalId));
    const row = rows[0];
    return row ? toAppUser(row) : undefined;
  }

  async upsert(externalId: string, email: string, name: string): Promise<AppUser> {
    await this.drizzle.db
      .insert(users)
      .values({ externalId, email, name })
      .onConflictDoNothing({ target: users.externalId });
    const found = await this.findByExternalId(externalId);
    if (!found) throw new Error(`upsert failed for externalId=${externalId}`);
    return found;
  }
}
```

- [ ] **Step 6: Implement — create `users.module.ts` (port provided; resolver added in Task 7)**

```ts
import { Module } from '@nestjs/common';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { DrizzleUserRepository } from './drizzle-user.repository';
import { USER_REPOSITORY } from './user.repository';

@Module({
  imports: [DrizzleModule],
  providers: [{ provide: USER_REPOSITORY, useClass: DrizzleUserRepository }],
  exports: [USER_REPOSITORY],
})
export class UsersModule {}
```

- [ ] **Step 7: Run test to verify it passes**

```bash
pnpm nx run api:test </dev/null 2>&1 | grep -E "DrizzleUserRepository|Test Files|Tests " | tail -10
```
Expected: PASS — `DrizzleUserRepository` tests (3) green; whole api suite green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/users/user.repository.ts apps/api/src/users/drizzle-user.repository.ts apps/api/src/users/drizzle-user.repository.spec.ts apps/api/src/users/users.module.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): UserRepository port + Drizzle impl (upsert on-conflict-do-nothing)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: API `UserResolver` guard (JIT provisioning)

**Files:**
- Create: `apps/api/src/users/user.resolver.ts`
- Create: `apps/api/src/users/user.resolver.spec.ts`
- Modify: `apps/api/src/users/users.module.ts`

**Interfaces:**
- Consumes: `USER_REPOSITORY` (`UserRepository`), `ClerkBackendService` (`getUserProfile`, `ClerkUserNotFoundError`), `AuthenticatedRequest` (`req.user` set by `ClerkGuard`).
- Produces: `UserResolver` (NestJS `CanActivate`). On activation: resolves `AppUser` (find → else backend fetch + upsert), sets `req.appUser`, returns true. 404 → `UnauthorizedException`; other backend errors → `ServiceUnavailableException('Unable to provision user')`; no `req.user` → `InternalServerErrorException`. Exported by `UsersModule`. Consumed by `MeController` (Task 8).

- [ ] **Step 1: Write the failing test — `user.resolver.spec.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { UserResolver } from './user.resolver';
import { ClerkUserNotFoundError } from '../clerk/clerk.backend';

const makeCtx = (user?: string): ExecutionContext => {
  const req: any = { user };
  return { switchToHttp: () => ({ getRequest: () => req }) } as any;
};
const appUser = { id: 'u-1', externalId: 'sub1', email: 'a@b.com', name: 'Alice' };

describe('UserResolver', () => {
  it('attaches an existing user without a backend call', async () => {
    const users = { findByExternalId: vi.fn().mockResolvedValue(appUser), upsert: vi.fn() };
    const backend = { getUserProfile: vi.fn() };
    const ctx = makeCtx('sub1');
    await expect(new UserResolver(users as any, backend as any).canActivate(ctx)).resolves.toBe(true);
    expect((ctx.switchToHttp().getRequest() as any).appUser).toEqual(appUser);
    expect(backend.getUserProfile).not.toHaveBeenCalled();
    expect(users.upsert).not.toHaveBeenCalled();
  });
  it('provisions a missing user: backend fetch + upsert + attach', async () => {
    const users = {
      findByExternalId: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(appUser),
      upsert: vi.fn().mockResolvedValue(appUser),
    };
    const backend = { getUserProfile: vi.fn().mockResolvedValue({ email: 'a@b.com', name: 'Alice' }) };
    const ctx = makeCtx('sub1');
    await new UserResolver(users as any, backend as any).canActivate(ctx);
    expect(backend.getUserProfile).toHaveBeenCalledWith('sub1');
    expect(users.upsert).toHaveBeenCalledWith('sub1', 'a@b.com', 'Alice');
    expect((ctx.switchToHttp().getRequest() as any).appUser).toEqual(appUser);
  });
  it('throws 401 (Unauthorized) when the Clerk user is gone (404)', async () => {
    const users = { findByExternalId: vi.fn().mockResolvedValue(undefined), upsert: vi.fn() };
    const backend = { getUserProfile: vi.fn().mockRejectedValue(new ClerkUserNotFoundError('sub1')) };
    await expect(new UserResolver(users as any, backend as any).canActivate(makeCtx('sub1'))).rejects.toThrow(
      'Clerk user no longer exists',
    );
  });
  it('throws 503 (Service Unavailable) on backend outage', async () => {
    const users = { findByExternalId: vi.fn().mockResolvedValue(undefined), upsert: vi.fn() };
    const backend = { getUserProfile: vi.fn().mockRejectedValue(new Error('network down')) };
    await expect(new UserResolver(users as any, backend as any).canActivate(makeCtx('sub1'))).rejects.toThrow(
      'Unable to provision user',
    );
  });
  it('throws when there is no verified subject (guard misconfiguration)', async () => {
    const users = { findByExternalId: vi.fn(), upsert: vi.fn() };
    const backend = { getUserProfile: vi.fn() };
    await expect(new UserResolver(users as any, backend as any).canActivate(makeCtx(undefined))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx run api:test </dev/null 2>&1 | grep -E "UserResolver|Test Files|Tests " | tail -10
```
Expected: FAIL — `./user.resolver` not found.

- [ ] **Step 3: Implement — create `user.resolver.ts`**

```ts
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthenticatedRequest } from '../clerk/clerk.guard';
import { ClerkBackendService, ClerkUserNotFoundError } from '../clerk/clerk.backend';
import { USER_REPOSITORY, UserRepository } from './user.repository';

@Injectable()
export class UserResolver implements CanActivate {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly clerkBackend: ClerkBackendService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const sub = req.user;
    if (!sub) throw new InternalServerErrorException('UserResolver ran without a verified Clerk subject');

    let appUser = await this.users.findByExternalId(sub);
    if (!appUser) {
      let profile;
      try {
        profile = await this.clerkBackend.getUserProfile(sub);
      } catch (e) {
        if (e instanceof ClerkUserNotFoundError) throw new UnauthorizedException('Clerk user no longer exists');
        throw new ServiceUnavailableException('Unable to provision user');
      }
      appUser = await this.users.upsert(sub, profile.email, profile.name);
    }
    req.appUser = appUser;
    return true;
  }
}
```

- [ ] **Step 4: Implement — provide + export `UserResolver` in `users.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ClerkModule } from '../clerk/clerk.module';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { DrizzleUserRepository } from './drizzle-user.repository';
import { USER_REPOSITORY } from './user.repository';
import { UserResolver } from './user.resolver';

@Module({
  imports: [DrizzleModule, ClerkModule],
  providers: [
    { provide: USER_REPOSITORY, useClass: DrizzleUserRepository },
    UserResolver,
  ],
  exports: [UserResolver],
})
export class UsersModule {}
```

(`ClerkModule` provides `ClerkBackendService`, which `UserResolver` injects.)

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm nx run api:test </dev/null 2>&1 | grep -E "UserResolver|Test Files|Tests " | tail -10
```
Expected: PASS — `UserResolver` tests (5) green; whole api suite green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/users/user.resolver.ts apps/api/src/users/user.resolver.spec.ts apps/api/src/users/users.module.ts
git commit -m "feat(api): UserResolver guard — JIT provision + resolve AppUser on auth

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Enrich `/api/me` + wire `UsersModule` + change `MeResponseSchema`

**Files:**
- Modify: `libs/shared/src/lib/shared.ts` (MeResponseSchema shape)
- Modify: `libs/shared/src/lib/shared.spec.ts` (MeResponse test)
- Modify: `apps/api/src/me/me.controller.ts`
- Modify: `apps/api/src/me/me.controller.spec.ts`
- Modify: `apps/api/src/app/app.module.ts`

**Interfaces:**
- Consumes: `UserResolver` (Task 7), `AppUser` on `req.appUser`, `MeResponseSchema`.
- Produces: `MeResponseSchema = { appUserId: uuid; clerkUserId: string; email: string; name: string }`; `GET /api/me` requires `@UseGuards(ClerkGuard, UserResolver)` and returns the enriched body.

- [ ] **Step 1: Write the failing test — update `shared.spec.ts` `MeResponseSchema` describe**

Replace the `MeResponseSchema` describe block with:

```ts
describe('MeResponseSchema', () => {
  const valid = { appUserId: '550e8400-e29b-41d4-a716-446655440000', clerkUserId: 'user_1', email: 'a@b.com', name: 'Alice' };
  it('parses appUserId + clerkUserId + email + name', () =>
    expect(MeResponseSchema.parse(valid)).toEqual(valid));
  it('rejects the old shape (clerkUserId only)', () =>
    expect(() => MeResponseSchema.parse({ clerkUserId: 'user_1' })).toThrow());
  it('rejects missing fields', () =>
    expect(() => MeResponseSchema.parse({ appUserId: valid.appUserId, clerkUserId: 'user_1' })).toThrow());
});
```

- [ ] **Step 2: Write the failing test — replace `me.controller.spec.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { MeController } from './me.controller';

const appUser = { id: '550e8400-e29b-41d4-a716-446655440000', externalId: 'user_abc', email: 'a@b.com', name: 'Alice' };

describe('MeController', () => {
  it('returns appUserId + clerkUserId + email + name from req.appUser', () => {
    expect(new MeController().me({ user: 'user_abc', appUser } as any)).toEqual({
      appUserId: appUser.id,
      clerkUserId: 'user_abc',
      email: 'a@b.com',
      name: 'Alice',
    });
  });
  it('throws if appUser is missing', () => {
    expect(() => new MeController().me({ user: 'user_abc' } as any)).toThrow();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm nx run shared:test </dev/null 2>&1 | grep -E "MeResponse|Test Files|Tests " | tail -8
pnpm nx run api:test </dev/null 2>&1 | grep -E "MeController|Test Files|Tests " | tail -8
```
Expected: shared FAIL (old `MeResponseSchema` parses `{clerkUserId}` — the "rejects old shape" test fails); api FAIL (`MeController.me` still returns `{clerkUserId}`).

- [ ] **Step 4: Implement — change `MeResponseSchema` in `shared.ts`**

Replace the `MeResponseSchema`/`MeResponse` lines in `libs/shared/src/lib/shared.ts` with:

```ts
export const MeResponseSchema = z.object({
  appUserId: z.string().uuid(),
  clerkUserId: z.string().min(1),
  email: z.string().min(1),
  name: z.string().min(1),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;
```

- [ ] **Step 5: Implement — replace `me.controller.ts`**

```ts
import { Controller, Get, InternalServerErrorException, Req, UseGuards } from '@nestjs/common';
import { MeResponseSchema } from '@linkz/shared';
import { ClerkGuard, AuthenticatedRequest } from '../clerk/clerk.guard';
import { UserResolver } from '../users/user.resolver';

@Controller('me')
@UseGuards(ClerkGuard, UserResolver)
export class MeController {
  @Get()
  me(@Req() req: AuthenticatedRequest) {
    if (!req.appUser || !req.user) throw new InternalServerErrorException('Not authenticated');
    return MeResponseSchema.parse({
      appUserId: req.appUser.id,
      clerkUserId: req.user,
      email: req.appUser.email,
      name: req.appUser.name,
    });
  }
}
```

- [ ] **Step 6: Implement — wire `UsersModule` in `app.module.ts`**

Add the import and include it in `imports`:

```ts
import { UsersModule } from '../users/users.module';
// ...
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: (env) => apiEnvSchema.parse(env) }),
    ClerkModule,
    DrizzleModule,
    UsersModule,
  ],
  controllers: [HealthController, MeController],
})
export class AppModule {}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
pnpm nx run shared:test </dev/null 2>&1 | grep -E "Test Files|Tests " | tail -5
pnpm nx run api:test </dev/null 2>&1 | grep -E "MeController|Test Files|Tests " | tail -8
pnpm nx run api:build </dev/null 2>&1 | tail -6
```
Expected: shared PASS; api PASS (all suites incl. `MeController`); `api:build` succeeds (webpack emits `dist/apps/api`).

- [ ] **Step 8: Commit**

```bash
git add libs/shared/src/lib/shared.ts libs/shared/src/lib/shared.spec.ts apps/api/src/me/me.controller.ts apps/api/src/me/me.controller.spec.ts apps/api/src/app/app.module.ts
git commit -m "feat(api): /api/me returns AppUser (appUserId + email + name) via UserResolver

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: Web — `deriveAuth.name` + `fetchMe` local `MeResponse` + welcome

**Files:**
- Modify: `apps/web/src/clerk/auth.ts`
- Modify: `apps/web/src/clerk/auth.spec.ts`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Produces: `AuthState.name: string | null` (`firstName+lastName || username || null`); local `MeResponse` interface `{ appUserId; clerkUserId; email; name }`; `fetchMe(): Promise<MeResponse>`. Welcome shows `auth().name ?? auth().userId`.

- [ ] **Step 1: Write the failing test — replace `auth.spec.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { deriveAuth, fetchMe } from './auth';

describe('deriveAuth', () => {
  it('signed-out when no session', () => {
    const a = deriveAuth({ isSignedIn: false, user: undefined, session: undefined } as any);
    expect(a.isSignedIn).toBe(false);
    expect(a.userId).toBeNull();
    expect(a.name).toBeNull();
    expect(a.getToken()).resolves.toBeNull();
  });
  it('signed-in with name from firstName/lastName', () => {
    const a = deriveAuth({ isSignedIn: true, user: { id: 'u1', firstName: 'Alice', lastName: 'Smith' }, session: { getToken: () => Promise.resolve('jwt') } } as any);
    expect(a.isSignedIn).toBe(true);
    expect(a.userId).toBe('u1');
    expect(a.name).toBe('Alice Smith');
    expect(a.getToken()).resolves.toBe('jwt');
  });
  it('signed-in name falls back to username', () => {
    const a = deriveAuth({ isSignedIn: true, user: { id: 'u1', firstName: '', lastName: '', username: 'alice' }, session: { getToken: () => Promise.resolve('jwt') } } as any);
    expect(a.name).toBe('alice');
  });
});

describe('fetchMe', () => {
  it('sends Bearer token + returns MeResponse', async () => {
    const body = { appUserId: 'u-1', clerkUserId: 'u1', email: 'a@b.com', name: 'Alice' };
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: () => Promise.resolve(body) } as any);
    const out = await fetchMe(() => Promise.resolve('jwt'));
    expect(out).toEqual(body);
    expect(spy).toHaveBeenCalledWith('/api/me', { headers: { Authorization: 'Bearer jwt' } });
  });
  it('throws when not authenticated', async () => {
    await expect(fetchMe(() => Promise.resolve(null))).rejects.toThrow('Not authenticated');
  });
  it('throws on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 401 } as any);
    await expect(fetchMe(() => Promise.resolve('jwt'))).rejects.toThrow('me request failed: 401');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx run web:test </dev/null 2>&1 | grep -E "deriveAuth|fetchMe|Test Files|Tests " | tail -10
```
Expected: FAIL — `AuthState` has no `name`; `fetchMe` return type mismatch.

- [ ] **Step 3: Implement — replace `auth.ts`**

```ts
import type { Clerk } from '@clerk/clerk-js';

export interface MeResponse {
  appUserId: string;
  clerkUserId: string;
  email: string;
  name: string;
}

export interface AuthState {
  isSignedIn: boolean;
  userId: string | null;
  name: string | null;
  getToken: () => Promise<string | null>;
}

export function deriveAuth(clerk: Clerk): AuthState {
  const user = clerk.user;
  const name = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || null : null;
  return {
    isSignedIn: !!clerk.isSignedIn,
    userId: user?.id ?? null,
    name,
    getToken: () => (clerk.session ? clerk.session.getToken() : Promise.resolve(null)),
  };
}

export async function fetchMe(getToken: () => Promise<string | null>): Promise<MeResponse> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`me request failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 4: Implement — show the name in `App.tsx` welcome**

In `apps/web/src/App.tsx`, change the welcome line inside `<SignedIn>`:

```tsx
        <p>Welcome, {auth().name ?? auth().userId}</p>
```

(Replace the existing `<p>Welcome, {auth().userId}</p>` line — leave the rest of `App.tsx` unchanged.)

- [ ] **Step 5: Run tests + build to verify they pass**

```bash
pnpm nx run web:test </dev/null 2>&1 | grep -E "Test Files|Tests " | tail -5
pnpm nx run web:build </dev/null 2>&1 | tail -6
```
Expected: web:test PASS (6 tests); web:build succeeds (`dist/apps/web`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/clerk/auth.ts apps/web/src/clerk/auth.spec.ts apps/web/src/App.tsx
git commit -m "feat(web): deriveAuth exposes name; fetchMe returns MeResponse; welcome shows name

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: End-to-end verification + final gates

**Files:** none (verification only); a final `chore` commit if any stray tracked files.

- [ ] **Step 1: Postgres up + migrations applied**

```bash
cd /Users/dkthezero/Vault/projects/linkz/.claude/worktrees/clerk-registry-authn
docker compose up -d </dev/null 2>&1 | tail -3
for i in $(seq 1 30); do docker compose ps postgres 2>/dev/null | grep -q healthy && break; sleep 1; done
set -a; . ./.env; set +a
pnpm nx run database:db-migrate </dev/null 2>&1 | tail -10
```
Expected: postgres healthy on `:18602`; `db-migrate` reports all migrations applied (no pending), exit 0.

- [ ] **Step 2: Lint all**

```bash
pnpm nx run-many -t lint </dev/null 2>&1 | tail -15
```
Expected: all projects PASS (0 errors; warnings acceptable).

- [ ] **Step 3: Test all**

```bash
pnpm nx run-many -t test </dev/null 2>&1 | tail -25
```
Expected: all projects PASS (database, shared, config, api, web).

- [ ] **Step 4: Build all**

```bash
pnpm nx run-many -t build </dev/null 2>&1 | tail -15
```
Expected: api + web build OK.

- [ ] **Step 5: API boots + `/api/me` is guarded**

```bash
cd /Users/dkthezero/Vault/projects/linkz/.claude/worktrees/clerk-registry-authn
set -a; . ./.env; set +a
pnpm nx run api:serve </dev/null > /tmp/api.serve.log 2>&1 &
API_PID=$!
for i in $(seq 1 40); do curl -sf http://localhost:18600/api/health >/dev/null 2>&1 && break; sleep 1; done
curl -s http://localhost:18600/api/health; echo " HEALTH_OK"
echo "no-token -> $(curl -s -o /dev/null -w '%{http_code}' http://localhost:18600/api/me)  (expect 401)"
kill $API_PID 2>/dev/null; wait $API_PID 2>/dev/null
```
Expected: `{"status":"ok"} HEALTH_OK`; `/api/me` without a Bearer token returns `401`.

- [ ] **Step 6: Web boots**

```bash
pnpm nx run web:serve </dev/null > /tmp/web.serve.log 2>&1 &
WEB_PID=$!
for i in $(seq 1 40); do curl -sf http://localhost:18601 >/dev/null 2>&1 && break; sleep 1; done
curl -sf http://localhost:18601 >/dev/null && echo "WEB_BOOT_OK"
kill $WEB_PID 2>/dev/null; pkill -f "vite" 2>/dev/null
```
Expected: `WEB_BOOT_OK`.

- [ ] **Step 7: Manual e2e (documented — requires real Clerk keys + Google enabled in the Clerk dashboard)**

1. Put real `CLERK_SECRET_KEY` + `CLERK_JWT_KEY` (PEM) in the worktree `.env`; put `VITE_CLERK_PUBLISHABLE_KEY` in `apps/web/.env.local`.
2. Enable Google as a social connection in the Clerk dashboard.
3. `pnpm nx run api:serve` + `pnpm nx run web:serve`.
4. Open `http://localhost:18601`, sign in with Google, click **Fetch /api/me**.
5. Expected: the response renders `{ appUserId, clerkUserId, email, name }`, and a row exists in `users` (`select external_id, email, name from users;` via `docker compose exec postgres psql -U linkz -d linkz`).
6. A second fetch (same session) must NOT call the Clerk Backend API again (user already in `users`) — observability: only the first request pays the Backend API cost.

- [ ] **Step 8: Final commit (only if there are stray tracked files from this feature)**

```bash
git status --short
# If the only changes are this feature's, and nothing of the user's parallel main edits is staged:
git add -A && git commit -m "chore: verify clerk registry & authn flow e2e (lint/test/build/serve)

Co-Authored-By: Claude <noreply@anthropic.com>" || echo "nothing to commit"
```
If `git status` shows the user's parallel edits on `main`-tracked files, do **not** stage them — skip the commit (`nothing to commit`) and surface them to the user instead.

---

## Self-Review notes

- **Spec coverage:** JIT provisioning → Tasks 1–8 ✓; `name` column + migration → Task 1 ✓; config via `@linkz/config` (guard refactor) → Task 4 ✓; Clerk Backend API email+name → Task 5 ✓; `UserRepository` port + Drizzle impl → Task 6 ✓; `UserResolver` guard (401/503 mapping) → Task 7 ✓; enriched `/api/me` → Task 8 ✓; web name in welcome + `fetchMe` type → Task 9 ✓; e2e gates → Task 10 ✓. Schema export → Task 2 ✓. `AppUserSchema` → Task 3 ✓.
- **Placeholder scan:** every code step has the actual code; no TBD/TODO/`add error handling`/`similar to Task N`.
- **Type consistency:** `AppUser` fields `{id, externalId, email, name}` match across `AppUserSchema` (T3), `DrizzleUserRepository.toAppUser` (T6), `UserResolver` (T7), `AuthenticatedRequest.appUser` (T4), `MeResponseSchema`/`MeController` (T8), web `MeResponse` (T9). `clerkConfigProvider`/`CLERK_CONFIG` consistent across T4/T5. `USER_REPOSITORY` token consistent T6/T7. `getUserProfile(sub)` consistent T5/T7. `ClerkUserNotFoundError` consistent T5/T7.
- **Intermediate breakage:** Task 3 leaves `MeResponseSchema` unchanged (only adds `AppUserSchema`) so the api stays green until Task 8 changes both the schema and the controller together. The api `me.controller.spec` is updated in lockstep with `MeResponseSchema` in Task 8.
- **Risks:** `db-migrate` applies `0000`+`0001` if `0000` was pending (Task 1/10 handle this). `drizzle-orm` added as an explicit api dep (Task 6) so `eq`/`users` imports are not transitive. Web stays self-contained (local `MeResponse` type — no `@linkz/shared` import, which the package.json-less web app cannot resolve).