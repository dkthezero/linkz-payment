# Clerk Registry & Authentication Flow — Design Spec

**Date:** 2026-06-19
**Status:** Approved (proceed to plan)
**Feature branch:** `feat/clerk-registry-authn`

## Goal

A user signs in with Google (via Clerk). On their first authenticated API call, the API **just-in-time provisions** them into the local `users` table ("registry success"), including a display **name**. Thereafter the user's Google/Clerk session JWT authorizes calls to the API, and downstream endpoints receive a resolved `AppUser` (id + externalId + email + name) — never touching Clerk directly.

## Background & current state

- Auth is delegated to Clerk (no password column). The `users` table is an identity mirror keyed by Clerk `sub` (`external_id`, unique).
- Existing (from skeleton, `main`): `ClerkGuard` verifies the Bearer JWT via `@clerk/backend` `verifyToken` and sets `req.user = sub`; `/api/me` echoes `{ clerkUserId }`. The guard reads `process.env` directly — violates the project rule "config only through `@linkz/config`".
- DB/model is live on `main`: Drizzle schema barrel exports `users`, `seats`, `reservations`, `payments`, `webhook_events`, `outbox`, `invoices`, `tickets`; migration `0000_conscious_leo.sql` exists. `@linkz/database` exports `createDb/getDb/DbClient` but **not the table objects**.
- `@clerk/backend@3.7.1` provides `verifyToken` and `createClerkClient(options): ClerkClient` (`clerkClient.users.getUser(sub)` returns the Clerk user).
- Architecture source of truth: `arch/model.c4` (Auth Guard validates JWT via JWKS), `arch/linkz.erd.json` (`users`, `webhook_events` ledger). The arch's webhook-idempotency invariant concerns the **payment** provider; Clerk user provisioning uses JIT, not webhooks.

## Scope

**In:**
- `users` table gains a `name` column (migration) — sanctioned model change requested by the user.
- API: refactor `ClerkGuard` to read `@linkz/config`; add `UserResolver` guard that JIT-registers + resolves the app user; enrich `/api/me` to return `{ appUserId, clerkUserId, email, name }`.
- API: `ClerkBackendService` (Clerk Backend API client for email + name); `UserRepository` port + Drizzle impl (hexagonal).
- `@linkz/shared`: enrich `MeResponseSchema`; add `AppUserSchema`.
- `@linkz/database`: export schema tables (wiring, not a model change).
- Web: extend `deriveAuth` to expose `name`; show the user's name in the welcome.

**Out (deferred):**
- Clerk `user.created` webhook receiver + `webhook_events` ledger usage (payment-webhook feature).
- Token refresh / 401 retry / logout-revoke on the web.
- Seat reservation flow (consumes `AppUser` later).
- Roles / permissions.

## Architecture & data flow

```
Web (SolidJS, ClerkProvider)
  └─ user signs in with Google (Clerk dashboard config) → Clerk session JWT
  └─ fetch('/api/me', { Authorization: Bearer <jwt> })
        ↓
API (NestJS)  @UseGuards(ClerkGuard, UserResolver)
  1. ClerkGuard    — verifyToken(jwt, {secretKey, jwtKey, authorizedParties}) from @linkz/config
                    → req.clerkClaims = {sub, sid}; req.user = sub
  2. UserResolver  — sub = req.user
                    ├─ userRepository.findByExternalId(sub)
                    ├─ found → req.appUser = row
                    └─ miss → clerkBackend.getUser(sub) → {email, name}
                              → userRepository.upsert(sub, email, name)  (ON CONFLICT DO NOTHING + re-SELECT)
                              → req.appUser = row
  3. Controller    — reads req.appUser; /api/me → {appUserId, clerkUserId, email, name}
```

`UserResolver` is a guard (runs after `ClerkGuard`) so a resolution failure rejects before the controller. It does I/O only on the authenticated path; the Clerk Backend API call happens **once per user** (only on first-seen). Subsequent requests are a single indexed SELECT by `external_id`.

## Units & interfaces

### `@linkz/shared`
- `AppUserSchema = z.object({ id: z.string().uuid(), externalId: z.string(), email: z.string(), name: z.string() })`; `export type AppUser = z.infer<typeof AppUserSchema>`.
- `MeResponseSchema = z.object({ appUserId: z.string().uuid(), clerkUserId: z.string(), email: z.string(), name: z.string() })`; `export type MeResponse = z.infer<typeof MeResponseSchema>`.

### `@linkz/database`
- `src/index.ts`: add `export * from './lib/schema'` (tables `users`, `webhook_events`, … importable as `import { users } from '@linkz/database'`).
- No table-shape change beyond the `name` column below.

### `apps/api/src/clerk/`
- `clerk.config.ts`: `ClerkConfig = { secretKey: string; jwtKey?: string; authorizedParties: string[] }`; `CLERK_CONFIG` injection token; factory reads the `@linkz/config`-validated env via NestJS `ConfigService` (authorizedParties split on `,`).
- `clerk.guard.ts`: injects `CLERK_CONFIG`; behavior unchanged (Bearer → verifyToken → claims); sets `req.clerkClaims` and `req.user`. No `process.env`.
- `clerk.backend.ts`: `ClerkBackendService` wraps `createClerkClient({ secretKey })`; `getUserProfile(sub): Promise<{ email: string; name: string }>` — calls `clerkClient.users.getUser(sub)`; derives `name = \`${firstName} ${lastName}\`.trim() || username || email`; `email = primary email address`. Throws `ClerkUserNotFoundError` on 404, rethrows others.
- `clerk.module.ts`: provides `CLERK_CONFIG`, `ClerkGuard`, `ClerkBackendService`.

### `apps/api/src/users/` (new feature module — the registry)
- `user.repository.ts`: port
  ```ts
  export interface UserRepository {
    findByExternalId(externalId: string): Promise<AppUser | undefined>;
    upsert(externalId: string, email: string, name: string): Promise<AppUser>;
  }
  export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
  ```
- `drizzle-user.repository.ts`: impl using `DrizzleService.db` + `users` table. `upsert` = `db.insert(users).values({externalId, email, name}).onConflictDoNothing({target: users.externalId})` then `findByExternalId` (returns the row whether inserted or pre-existing — idempotent vs concurrent first-requests).
- `user.resolver.ts`: `UserResolver` guard. Injects `USER_REPOSITORY` + `ClerkBackendService`. Logic per data flow. On `ClerkUserNotFoundError` → `UnauthorizedException` (401); on other `ClerkBackendService` errors → `ServiceUnavailableException` (503, message "Unable to provision user"). If `req.user` absent (guard ran without `ClerkGuard`) → `InternalServerErrorException` (misconfiguration).
- `users.module.ts`: provides `DrizzleUserRepository` bound to `USER_REPOSITORY`, exports `UserResolver`.

### `apps/api/src/me/me.controller.ts`
- `@UseGuards(ClerkGuard, UserResolver)`; `me(@Req() req)` returns `MeResponseSchema.parse({ appUserId: req.appUser.id, clerkUserId: req.user, email: req.appUser.email, name: req.appUser.name })`.

### `apps/api/src/app/app.module.ts`
- imports `UsersModule` (already imports `ClerkModule`).

### Web (`apps/web/src/clerk/auth.ts`, `App.tsx`)
- `AuthState` gains `name: string | null` = `clerk.user ? [firstName, lastName].filter(Boolean).join(' ') || username || null : null`. Update spec.
- `fetchMe` return type → a **local** `MeResponse` interface `{ appUserId: string; clerkUserId: string; email: string; name: string }` (the web app has no `package.json` and cannot resolve `@linkz/shared`; it only displays the JSON, so a local type matching the API's `MeResponseSchema` shape is used — formal shared-types wiring for web is deferred). Update spec to assert the shape.
- `App.tsx` welcome: `Welcome, {auth().name ?? auth().userId}`. (The welcome uses `auth().name` — available immediately from Clerk's frontend user, no API call. The `Fetch /api/me` button proves the registry returns the same `name` from the DB.)

## Data model change

`users` gains `name`:
```ts
name: varchar('name').notNull(),
```
- Sanctioned by the user (needed for welcome + seat reservation display).
- NOT NULL, always populated: `name = firstName+lastName || username || email` (email fallback guarantees a displayable value even for accounts without a profile name).
- The table is empty (fresh DB), so no backfill. Generate migration `0001_*` via `database:db-generate`; apply via `database:db-migrate` against the running Postgres (`:18602`). (The initial `0000` migration must also be applied if not already.)

## Error handling

| Condition | Response |
|---|---|
| Missing/empty Bearer | 401 `Missing/Empty Bearer token` (ClerkGuard) |
| `verifyToken` throws | 401 `Invalid or expired Clerk session token` (ClerkGuard) |
| Clerk Backend API: user 404 | 401 (user gone) |
| Clerk Backend API: network/5xx | 503 `Unable to provision user` |
| DB failure | bubbles to global exception filter → 500 |
| Concurrent first-request same `sub` | `ON CONFLICT DO NOTHING` + re-SELECT → both resolve to the same row; no unique-violation leak |

No secrets leaked in messages. No password handling anywhere.

## Testing strategy (TDD — failing test → impl → green, per unit)

- `@linkz/shared`: `MeResponseSchema`/`AppUserSchema` parse-accepts valid, rejects missing/invalid fields.
- `@linkz/database`: schema tables are exported from the package (import + type test).
- api `clerk.config`: factory builds `ClerkConfig` from validated env (authorizedParties split).
- api `clerk.guard`: existing 4 behaviors preserved + new "uses injected `CLERK_CONFIG`, not `process.env`" (mutate env, assert guard unaffected / uses provided config).
- api `clerk.backend`: `getUserProfile` happy path (mock `createClerkClient` → `users.getUser`) returns `{email, name}`; name fallback chain; 404 → `ClerkUserNotFoundError`; other error rethrown.
- api `user.repository` (Drizzle impl): `findByExternalId` (mock `db.query.users`); `upsert` calls `insert(...).onConflictDoNothing` then re-selects (mock `db.insert`).
- api `user.resolver`: existing user → attaches `appUser`, no backend call; missing user → backend fetch + upsert + attach; backend 404 → 401; backend 5xx → 503; no `req.user` → 500-class.
- api `me.controller`: returns enriched body parsed by `MeResponseSchema` from `req.appUser` + `req.user`.
- web `auth.spec`: `deriveAuth` exposes `name` from `clerk.user` (with fallback).
- Manual e2e (documented): Postgres up + migrate; boot API; with a real Clerk JWT (Google login), `GET /api/me` → `{appUserId, clerkUserId, email, name}` and a row exists in `users`.

Mocks: `@clerk/backend` `createClerkClient` mocked at module level; `DrizzleService.db` mocked (query/insert chains). `ClerkGuard` config injected via test module.

## Constraints & invariants (preserved)

- No password storage (auth delegated to Clerk).
- Config only through `@linkz/config` (guard refactor removes `process.env`).
- Zod at the boundary; types via `z.infer`; schemas in `@linkz/shared`.
- Thin controllers; logic in services/guards; depend on injected ports (`UserRepository`), not concretions.
- One Nest module per feature (`users`).
- No new DB tables beyond the `name` column on `users`; no `webhook_events` use this feature.

## Risks / open items

- **Clerk Backend API in the request path** adds one external call per new user (once only). Acceptable; cache not needed (indexed SELECT thereafter). If the Clerk user has no name/email at all, `email` is required for the row (NOT NULL) — provisioning fails with 503, surfaced to the user as "try again". Mitigation: name falls back to email; email is mandatory from Clerk.
- **JWT claims vs Backend API**: we use the Backend API (not JWT claims) for email/name so the feature works with Clerk's default session-token template (no dashboard JWT customization required).
- **Migration application**: assumes `0000` is applied or will be by `db-migrate`; verify tables exist before the e2e.