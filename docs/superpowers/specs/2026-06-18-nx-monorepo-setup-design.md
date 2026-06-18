# Nx Monorepo Setup — Design Spec

**Date:** 2026-06-18
**Project:** Linkz (seat-reservation platform — senior engineer assessment)
**Scope:** Scaffold the Nx monorepo skeleton + wire up all dependencies. No business features, no database schema.

## Context

This is the Linkz technical assessment: a public seat-reservation platform (3 seats, login with
90-day session expiry, seat hold → payment → confirm). The system architecture is already specified
in `arch/model.c4` (SolidJS SPA, NestJS resource server validating Clerk JWTs, Postgres + Drizzle,
mock Stripe-shaped payment provider with signed webhooks, reservation saga with hexagonal
architecture, invoice/ticket modules, outbox + webhook-event ledger). `arch/linkz.erd.json` is
empty (0 bytes), so the data model is not yet formalized — by design we do **not** create the
schema in this task.

This task produces a **runnable skeleton with all dependencies wired**, ready for feature work to
land in subsequent tasks.

## Non-goals (explicitly deferred)

- Defining the Drizzle schema, writing migrations, or seeding data (a later task).
- Implementing any business logic in Seats / Reservations / Payments / Invoices / Tickets modules.
- The mock payment provider service.
- Deploying beyond local dev.

## 1. Tooling & repository layout

- **Package manager:** pnpm (11.6+). Workspace created via `create-nx-workspace --pm pnpm`.
- **Nx** 20+, plugins: `@nx/js`, `@nx/nest`, `@nx/vite`, `@nx/vitest`, `@nx/eslint`.
- **Node** 26 pinned via `.nvmrc` and `engines` in the root `package.json`.
- **Git** initialized at the workspace root (the project is currently not a repo), with a
  `.gitignore` and an initial commit.
- Nx-convention layout:
  - `apps/web` — SolidJS SPA (Vite + Solid)
  - `apps/api` — NestJS resource server
  - `libs/database` — Drizzle client + config (dependency wiring only; no schema)
  - `libs/shared` — Zod schemas + TS enums/types shared by web & api
  - `libs/config` — env loading + zod validation, shared
- `nx.json` configured for pnpm, with caching and named inputs; a `project.json` per app/lib.
- `.npmrc` with `node-linker=hoisted` if required for native-ESM deps (Clerk/Drizzle) — added only
  if a hoisting issue actually surfaces during verification.

## 2. Frontend — `apps/web` (SolidJS + Vite)

- Scaffolded as a Vite + Solid-TS app, registered in Nx via the `@nx/vite` executor (build/serve/dev
  targets). Nx has no official SolidJS generator, so this manual Vite+Solid integration is the
  cleanest supported path.
- **Clerk** integration:
  - Primary: `@clerk/clerk-solid` (official Clerk Solid SDK) — availability to be verified during
    planning/implementation.
  - Fallback: `@clerk/clerk-js` wrapped in a Solid context if the Solid SDK is unavailable.
  - Env: `VITE_CLERK_PUBLISHABLE_KEY`.
  - OIDC/PKCE login flow is handled by Clerk.
- Minimal runnable shell: `<ClerkProvider>`, signed-in/out routing, a "Seats" placeholder route,
  and a signed-in view that calls `GET /api/me` (Bearer token attached by Clerk) and renders the
  returned `clerkUserId` — proving the auth guard accepts a real session token end to end.

## 3. Backend — `apps/api` (NestJS)

- `@nx/nest` application. Global prefix `/api`, CORS allow-listing the web origin.
- **Clerk Auth Guard** built on `@clerk/backend`: validates `Authorization: Bearer <session token>`
  against JWKS (cached), attaches `req.user = clerkUserId`. A custom guard (not a community wrapper)
  to match the C4 "Auth Guard validates JWT via JWKS" and keep control.
- **DrizzleModule**: a NestJS module that provides the `libs/database` client (request-scoped where
  appropriate).
- **Domain modules scaffolded as empty, registered modules** so the architecture skeleton boots and
  the structure exists for feature work (no business logic):
  - `SeatsModule`
  - `ReservationsModule` — with the hexagonal folder skeleton (`controller` / `saga` / `domain` /
    `repo`) as empty stubs
  - `PaymentsModule`
  - `InvoicesModule`
  - `TicketsModule`
- Supporting wiring:
  - `HealthController` — `GET /api/health` → 200 (public, proves API connectivity).
  - `MeController` — `GET /api/me` → `{ clerkUserId }`, protected by `ClerkGuard` (proves the
    Bearer-token guard accepts a real Clerk session token).
  - Config validation on boot via `libs/config`.
  - Graceful shutdown hooks.
- Env: `CLERK_SECRET_KEY`, `CLERK_JWKS_URL` (or Clerk instance URL), `DATABASE_URL`, `PORT`,
  `CORS_ORIGIN`.

## 4. Database — `libs/database` (DEPENDENCY WIRING ONLY)

This segment wires up Drizzle and the Postgres driver but defines **no schema, no migrations, no
seed**. Those land in a later task.

- Install `drizzle-orm`, `drizzle-kit`, `postgres` (postgres-js driver).
- Create the `libs/database` Nx library with:
  - `drizzle.config.ts` — skeleton config pointing at `DATABASE_URL`, migrations directory
    placeholder, dialect `postgresql`. (No actual schema file referenced yet / empty schema.)
  - A DB client module — exports a Drizzle client constructor wired to `DATABASE_URL` via
    `drizzle-orm/postgres-js`.
  - An empty/placeholder `schema.ts` (or none) — explicitly no table definitions.
  - `project.json` targets: `db:generate`, `db:migrate`, `db:push` (drizzle-kit) — wired and
    runnable, but with nothing to generate/migrate until the schema exists.
- Consumed by `apps/api` via the DrizzleModule.

## 5. Shared — `libs/shared` and `libs/config`

- `libs/shared`: Zod schemas + TS enums/types that both web and api import (reservation status,
  seat status, API response shapes). Empty/minimal placeholder schemas only — no business DTOs yet.
- `libs/config`: env loading + zod validation. Defines the validated env shape for api (Clerk,
  DB, port, CORS) and web (Clerk publishable key, API base URL). Throws on missing required vars at
  boot.
- TS path aliases wired through Nx/tsconfig so `@linkz/shared`, `@linkz/config`, `@linkz/database`
  resolve across the workspace.

## 6. Dev infra

- `docker-compose.yml` — Postgres 16, named volume, healthcheck, `POSTGRES_DB=linkz`,
  `POSTGRES_USER/PASSWORD` from env, exposed port from env.
- `.env.example` at root and per app, with every required var documented.
- Vitest for apps + libs (Nx vitest generators). ESLint + Prettier via Nx defaults.
- **README** with: stack overview, prerequisites (Node 26, pnpm, Docker), setup steps, env
  configuration guidance (including the Clerk dashboard setup and the **90-day session-token
  lifetime** setting), the script/task list, and local run instructions. The assessment explicitly
  requires README + setup + env guidance.

## 7. Verification (proves the skeleton works)

A single end-to-end local run, all green:

1. `pnpm install` succeeds.
2. `docker compose up -d` starts Postgres (healthy).
3. `pnpm nx run api:serve` boots NestJS; `GET /api/health` → 200.
4. `pnpm nx run web:serve` boots Vite; the SPA loads, Clerk provider mounts, login flow present.
5. An authenticated request from the web app to `GET /api/me` carries the Clerk Bearer token and
   the NestJS `ClerkGuard` accepts it, returning `{ clerkUserId }` rendered in the UI.
6. `pnpm nx run-many -t build` and `pnpm nx run-many -t lint` pass for all projects.
7. Drizzle targets (`db:generate` etc.) invoke `drizzle-kit` without crashing (no-op until schema
   exists).

## 8. Open items to confirm during planning

- Official availability of `@clerk/clerk-solid` vs. fallback to `@clerk/clerk-js`.
- Exact `@nx/vite` + Solid `project.json` configuration that boots cleanly under Nx.
- Whether `@clerk/backend` JWKS caching API requires `CLERK_JWKS_URL` or derives it from
  `CLERK_SECRET_KEY`/instance domain.