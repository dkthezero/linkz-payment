<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

# Linkz — project guide

Public seat-reservation platform (3 seats). Nx monorepo · pnpm · TypeScript. Architecture-as-code lives in `arch/` and is the source of truth for design — read it before changing behaviour.

## Stack & layout
- `api` — NestJS resource server. Port **18600**, global prefix `/api`.
- `web` — SolidJS SPA, port **18601**. *(planned — not yet scaffolded)*
- `libs/shared` (`@linkz/shared`) — Zod schemas + shared types; `libs/config` (`@linkz/config`) — env validation.
- `database` lib — Drizzle + postgres-js. *(planned)*
- Postgres 16 via `docker compose up -d` (host port **18602**). Auth: **Clerk** (OIDC), 90-day session.

## Architecture (`arch/`, LikeC4 + ERD)
`model.c4` (landscape + shared spec) · `reservation.c4` (saga + seat-status state machine) · `payment.c4` (payment-status state machine) · `linkz.erd.json` (ERD, dineug erd-editor). View `.c4` edits via the **LikeC4** VS Code extension (`likec4.likec4-vscode`) — click **Open Preview** on a `view` block. Keep `arch/` in sync with code.

## Invariants — do not weaken
- **No password storage** — auth is delegated to Clerk; the API only validates Clerk JWTs (JWKS).
- **Seat concurrency** — at most one active reservation per seat, enforced by a *partial-unique* index (`status IN ('held','confirmed')`) + an atomic hold. Never replace it with app-level checks alone.
- **Webhook idempotency** — verify the provider signature and process each event once via the event ledger; confirm a reservation only on `payment.succeeded`.
- **Saga** — failures *before* payment capture **compensate** (release the seat); steps *after* capture (invoice/ticket) are **forward-recovery** (retry), never auto-refund.

## Conventions
- Run everything through nx: `pnpm nx run api:serve`, `pnpm nx run-many -t test|lint|build`.
- TDD with vitest. Secrets via env files only (`.env`, `web/.env.local`) — never commit keys.

## Best practices (keep it simple)
- **TypeScript** — `strict` on; no `any` (use `unknown` + narrow). Prefer union literals + `as const` over enums. Validate external input with Zod at the boundary and derive types via `z.infer` (schemas live in `@linkz/shared`). Avoid `!` non-null assertions.
- **NestJS** — thin controllers, logic in services/use-cases; depend on injected ports, not concretions. One module per feature. Read config only through `@linkz/config`, never `process.env` in services. Validate DTOs with a Zod pipe; surface errors through one global exception filter.
- **SolidJS** — never destructure `props` (kills reactivity) — read `props.x`. Use signals + `createMemo` for derived state and `createResource` for async; keep `createEffect` rare. Render with `<Show>`/`<For>`, not ternaries/`.map`. Components stay small and presentational; reach the API through a thin client.
