# Linkz

Public seat-reservation platform: sign in, pick one or more seats, pay once, get e-tickets.

**Nx monorepo** · **TypeScript** · **NestJS API** + **SolidJS SPA** · **Clerk auth** · **Postgres + Drizzle**.

Built for the Senior/Lead engineering assessment (`docs/`); the design in `arch/` (LikeC4 + ERD) is the source of truth.

## Quick start

**Prerequisites:** Install the [Stripe CLI](https://dashboard.stripe.com/downloads) (`brew install stripe/stripe-cli/stripe`) and run `stripe login` once. Each developer needs their own Stripe team membership to authenticate the CLI and receive webhook events locally.

```bash
# Get Stripe auth to allow port forwarding
stripe login

# Boot the whole system with one command
# Postgres + stripe listen + API (:18600) + web (:18601), Ctrl-C stops all
pnpm dev    
```

> **Test card:** `4242 4242 4242 4242` · any future expiry (e.g. `12/34`) · any 3-digit CVC · any other values.

## Clerk setup

1. Create an app at [clerk.com](https://clerk.com).
2. **Secret key** → `CLERK_SECRET_KEY` (`.env`); **Publishable key** → `VITE_CLERK_PUBLISHABLE_KEY` (`web/.env.local`).
3. **Sessions → Maximum lifetime = 90 days.**
4. SPA OAuth: mark the app **Public** (PKCE S256, token auth `none`); add `http://localhost:18601` to authorized origins / `authorizedParties`.
5. *Optional* networkless JWT verify: API Keys → **JWKS Public Key (PEM)** → `CLERK_JWT_KEY`.

## Commands

```bash
pnpm test | pnpm lint | pnpm build          # all projects (vitest / eslint)
pnpm nx run <project>:test                  # one project: api, web, @linkz/{shared,config,database}
pnpm nx run @linkz/database:db-push         # sync schema (also: db-generate, db-migrate, db-studio)
```

| Service | Port |
|---------|-------|
| API | 18600 |
| Web | 18601 |
| Postgres | 18602 |

## Architecture

`arch/` is the design source of truth. Install the extensions first, then open the files below:

| Extension | Install |
|-----------|---------|
| **LikeC4** - previews `.c4` models | [Install LikeC4](vscode:extension/likec4.likec4-vscode) |
| **ERD Editor** - opens `linkz.erd.json` | [Install ERD Editor](vscode:extension/dineug.vuerd-vscode) |

Open a `.c4` file and click **Open Preview** on a `view { … }` block to render the diagram:

- [`System Design`](arch/linkz-platform-architecture.md)
- [`arch/model.c4`](arch/model.c4) - system landscape + shared spec
- [`arch/reservation.c4`](arch/reservation.c4) - reservation saga + seat-status state machine
- [`arch/payment.c4`](arch/payment.c4) - payment-status state machine
- [`arch/linkz.erd.json`](arch/linkz.erd.json) - database ERD (dineug erd-editor)

## Layout

```bash
arch/      LikeC4 models + ERD (design source of truth)
docs/      assessment brief, UX mockups
api/       NestJS resource server   (port 18600, prefix /api)
web/       SolidJS SPA              (port 18601)
e2e/       Playwright end-to-end tests
libs/
  shared/    Zod schemas + shared types   (@linkz/shared)
  config/    env validation               (@linkz/config)
  database/  Drizzle + postgres-js        (@linkz/database)
scripts/   dev tooling - dev.sh (one-command local boot)
```