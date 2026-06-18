# Linkz Nx Monorepo Skeleton — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Scaffold an Nx 23 monorepo (NestJS api + SolidJS web) with Clerk auth and Drizzle/Postgres wiring — runnable skeleton, no business features, no DB schema.

**Architecture:** Nx integrated workspace, pnpm. `apps/api` (NestJS ^11, Clerk JWT guard, Drizzle module), `apps/web` (Vite+Solid, `@clerk/clerk-js` wrapped in Solid context), `libs/{shared,config,database}` non-buildable TS libs via tsconfig path aliases. All deps hoisted to root.

**Tech Stack:** Nx 23, pnpm 11, Node 26, TS 5.4–5.9, NestJS 11, SolidJS 1.9 + Vite 8, Vitest 4, `@clerk/backend` 3.8, `@clerk/clerk-js` 6, Drizzle 0.45 + postgres-js 3.4 + drizzle-kit 0.31, Postgres 16, zod.

## Global Constraints

- Ports: **API 18600 · Web 18601 · Postgres(host) 18602**.
- `DATABASE_URL=postgres://linkz:linkz@localhost:18602/linkz`.
- `CORS_ORIGIN=http://localhost:18601`; Clerk `authorizedParties=['http://localhost:18601']`.
- Vite proxies `/api` → `http://localhost:18600`.
- TS must stay `>=5.4.2 <5.10.0` (Nx 23 constraint). Do not bump.
- Node `>=22.12.0`, pnpm `>=11`.
- All `pnpm add` run at workspace root (integrated setup, deps hoisted).
- No DB schema, no migrations content, no seed (wiring only). `db:generate` is a valid no-op.
- TDD for every code-bearing unit: failing test → impl → green → commit.
- Commit message prefix: `chore:`/`feat:`/`test:`. End with `Co-Authored-By: Claude <noreply@anthropic.com>`.

---

## File Structure (target)

```
linkz/
├── .gitignore  .nvmrc  .env.example
├── package.json  pnpm-workspace.yaml  pnpm-lock.yaml  nx.json
├── tsconfig.base.json  tsconfig.json
├── docker-compose.yml  README.md
├── arch/  (model.c4, reservation.c4, payment.c4, linkz.erd.json — source of truth, pre-existing)
├── docs/  (Lead Engineer Assessment.md, superpowers/{plans,specs} — pre-existing)
├── apps/
│   ├── api/  (project.json, src/main.ts, src/app/app.module.ts,
│   │          src/health/, src/me/, src/clerk/, src/drizzle/)
│   └── web/  (project.json, vite.config.ts, src/index.tsx, src/App.tsx,
│              src/clerk/{ClerkContext.tsx,components.tsx,auth.ts})
└── libs/
    ├── shared/  (src/index.ts, src/lib/shared.ts)
    ├── config/  (src/index.ts, src/lib/config.ts)
    └── database/ (drizzle.config.ts, src/index.ts, src/client.ts, src/schema/index.ts)
```

---

## Task 1: Initialize workspace + git

**Files:** Create `linkz/` (workspace), `.gitignore`, `.nvmrc`; modify root `package.json` (engines).

- [ ] **Step 1: Create Nx 23 pnpm workspace (non-interactive)**

```bash
cd /Users/dkthezero/Vault/projects/linkz
pnpm dlx create-nx-workspace@latest linkz \
  --pm=pnpm --template=nrwl/empty-template --nxCloud=skip --interactive=false
```
Expected: `linkz/` with `nx.json`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, empty `apps/`.

- [ ] **Step 2: Move workspace contents up into project root**

The project root is `/Users/dkthezero/Vault/projects/linkz` and already holds `arch/`, `docs/`, `.agents/`, `.claude/`. Scaffold into a temp name then merge:

```bash
cd /Users/dkthezero/Vault/projects/linkz
# create-nx-workspace created ./linkz — merge it into the project root
shopt -s dotglob
mv linkz/* . 
rmdir linkz
shopt -u dotglob
ls
```
Expected: `arch docs apps nx.json package.json pnpm-workspace.yaml tsconfig.base.json ...` at project root.

- [ ] **Step 3: Pin Node + engines**

`.nvmrc`:
```
26
```

Add to root `package.json` (after `"name"`):
```json
"engines": { "node": ">=22.12.0", "pnpm": ">=11" },
```

- [ ] **Step 4: Init git + initial commit**

```bash
cd /Users/dkthezero/Vault/projects/linkz
git init -b main
git add .
git commit -m "chore: init Nx 23 workspace

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Add Nx plugins

- [ ] **Step 1: Add plugins**

```bash
pnpm dlx nx add @nx/nest
pnpm dlx nx add @nx/vite
pnpm dlx nx add @nx/vitest
pnpm dlx nx add @nx/js
pnpm dlx nx add @nx/eslint
```
Expected: each updates `nx.json`/`package.json`. `@nx/vitest` is separate (vitest split from @nx/vite in Nx 23).

- [ ] **Step 2: Verify plugin registration**

```bash
pnpm dlx nx report 2>&1 | head -40
```
Expected: lists @nx/nest, @nx/vite, @nx/vitest, @nx/js, @nx/eslint.

- [ ] **Step 3: Commit**

```bash
git add . && git commit -m "chore: add nx plugins (nest,vite,vitest,js,eslint)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Scaffold NestJS api + verify boot

- [ ] **Step 1: Generate api app**

```bash
pnpm dlx nx g @nx/nest:application apps/api \
  --e2eTestRunner=none --unitTestRunner=vitest --linter=eslint \
  --standaloneConfig --strict --tags=scope:api,type:app
```
Expected: `apps/api/` with `project.json`, `src/main.ts`, `src/app/app.{module,controller,service}.ts` + specs.

- [ ] **Step 2: Run generated test**

```bash
pnpm nx run api:test
```
Expected: PASS (generated app.service.spec).

- [ ] **Step 3: Verify boot (default port 3000)**

```bash
pnpm nx run api:serve > /tmp/api.serve.log 2>&1 &
SERVE_PID=$!
for i in $(seq 1 40); do grep -q "Nest application successfully started" /tmp/api.serve.log && break; sleep 1; done
grep -q "Nest application successfully started" /tmp/api.serve.log && echo "API_BOOT_OK" || (cat /tmp/api.serve.log; exit 1)
kill $SERVE_PID 2>/dev/null
```
Expected: `API_BOOT_OK`.

- [ ] **Step 4: Commit**

```bash
git add . && git commit -m "chore: scaffold nestjs api app

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: libs/config — env validation (TDD)

**Files:** Create `libs/config/src/lib/config.ts`, `libs/config/src/index.ts`, `.../config.spec.ts`.

- [ ] **Step 1: Generate lib**

```bash
pnpm dlx nx g @nx/js:library libs/config --bundler=none --importPath=@linkz/config \
  --unitTestRunner=vitest --linter=eslint --strict --tags=scope:config,type:util
pnpm add zod
```

- [ ] **Step 2: Write failing test** — `libs/config/src/lib/config.spec.ts`

```ts
import { describe, it, expect } from 'vitest';
import { apiEnvSchema, webEnvSchema } from './config';

describe('apiEnvSchema', () => {
  it('parses a valid env with defaults', () => {
    const out = apiEnvSchema.parse({
      DATABASE_URL: 'postgres://u:p@localhost:18602/linkz',
      CLERK_SECRET_KEY: 'sk_test_x',
    });
    expect(out.PORT).toBe(18600);
    expect(out.CORS_ORIGIN).toBe('http://localhost:18601');
    expect(out.NODE_ENV).toBe('development');
  });
  it('rejects missing DATABASE_URL', () => {
    expect(() => apiEnvSchema.parse({ CLERK_SECRET_KEY: 'sk_test_x' })).toThrow();
  });
  it('rejects missing CLERK_SECRET_KEY', () => {
    expect(() => apiEnvSchema.parse({ DATABASE_URL: 'postgres://u:p@h/db' })).toThrow();
  });
});

describe('webEnvSchema', () => {
  it('requires publishable key', () => {
    expect(() => webEnvSchema.parse({})).toThrow();
    expect(webEnvSchema.parse({ VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_x' }).VITE_CLERK_PUBLISHABLE_KEY).toBe('pk_test_x');
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
pnpm nx run config:test
```
Expected: FAIL (schemas not defined).

- [ ] **Step 4: Implement** — `libs/config/src/lib/config.ts`

```ts
import { z } from 'zod';

export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(18600),
  CORS_ORIGIN: z.string().default('http://localhost:18601'),
  DATABASE_URL: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_JWT_KEY: z.string().optional(),
  CLERK_AUTHORIZED_PARTIES: z.string().default('http://localhost:18601'),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const webEnvSchema = z.object({
  VITE_CLERK_PUBLISHABLE_KEY: z.string().min(1),
});

export type WebEnv = z.infer<typeof webEnvSchema>;
```

- [ ] **Step 5: Ensure re-export** — `libs/config/src/index.ts`

```ts
export * from './lib/config';
```

- [ ] **Step 6: Run — expect PASS**

```bash
pnpm nx run config:test
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add . && git commit -m "feat(config): zod env schemas for api + web

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: libs/shared — shared schemas (TDD)

**Files:** `libs/shared/src/lib/shared.ts`, `libs/shared/src/index.ts`, `.../shared.spec.ts`.

- [ ] **Step 1: Generate lib**

```bash
pnpm dlx nx g @nx/js:library libs/shared --bundler=none --importPath=@linkz/shared \
  --unitTestRunner=vitest --linter=eslint --strict --tags=scope:shared,type:util
```

- [ ] **Step 2: Write failing test** — `libs/shared/src/lib/shared.spec.ts`

```ts
import { describe, it, expect } from 'vitest';
import { HealthResponseSchema, MeResponseSchema } from './shared';

describe('HealthResponseSchema', () => {
  it('parses ok', () => expect(HealthResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' }));
  it('rejects other', () => expect(() => HealthResponseSchema.parse({ status: 'bad' })).toThrow());
});

describe('MeResponseSchema', () => {
  it('parses clerkUserId', () =>
    expect(MeResponseSchema.parse({ clerkUserId: 'user_1' })).toEqual({ clerkUserId: 'user_1' }));
  it('rejects missing', () => expect(() => MeResponseSchema.parse({})).toThrow());
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
pnpm nx run shared:test
```

- [ ] **Step 4: Implement** — `libs/shared/src/lib/shared.ts`

```ts
import { z } from 'zod';

export const HealthResponseSchema = z.object({ status: z.literal('ok') });
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const MeResponseSchema = z.object({ clerkUserId: z.string().min(1) });
export type MeResponse = z.infer<typeof MeResponseSchema>;
```

- [ ] **Step 5: Re-export** — `libs/shared/src/index.ts`

```ts
export * from './lib/shared';
```

- [ ] **Step 6: Run — expect PASS**

```bash
pnpm nx run shared:test
```

- [ ] **Step 7: Commit**

```bash
git add . && git commit -m "feat(shared): health + me response schemas

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: api — rewrite main + HealthController (TDD)

**Files:** Modify `apps/api/src/main.ts`, `apps/api/src/app/app.module.ts`; create `apps/api/src/health/health.controller.ts` + spec; delete generated `app.controller.*`, `app.service.*`.

- [ ] **Step 1: Install @nestjs/config**

```bash
pnpm add @nestjs/config
```

- [ ] **Step 2: Write failing test** — `apps/api/src/health/health.controller.spec.ts`

```ts
import { describe, it, expect } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns { status: ok }', () => {
    expect(new HealthController().health()).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
pnpm nx run api:test
```

- [ ] **Step 4: Implement** — `apps/api/src/health/health.controller.ts`

```ts
import { Controller, Get } from '@nestjs/common';
import { HealthResponseSchema } from '@linkz/shared';

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return HealthResponseSchema.parse({ status: 'ok' });
  }
}
```

- [ ] **Step 5: Rewrite app.module.ts** — `apps/api/src/app/app.module.ts`

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { apiEnvSchema } from '@linkz/config';
import { HealthController } from '../health/health.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: (env) => apiEnvSchema.parse(env) })],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 6: Rewrite main.ts** — `apps/api/src/main.ts`

```ts
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  const config = app.get(ConfigService);
  app.enableCors({ origin: config.get<string>('CORS_ORIGIN') });
  const port = config.get<number>('PORT') ?? 18600;
  await app.listen(port);
  Logger.log(`API ready on http://localhost:${port}/api`, 'Bootstrap');
}
bootstrap();
```

- [ ] **Step 7: Remove generated app controller/service**

```bash
rm -f apps/api/src/app/app.controller.ts apps/api/src/app/app.controller.spec.ts apps/api/src/app/app.service.ts apps/api/src/app/app.service.spec.ts
```

- [ ] **Step 8: Run test — expect PASS**

```bash
pnpm nx run api:test
```

- [ ] **Step 9: Verify boot on 18600**

```bash
DATABASE_URL=postgres://linkz:linkz@localhost:18602/linkz CLERK_SECRET_KEY=sk_test_dev \
pnpm nx run api:serve > /tmp/api.serve.log 2>&1 &
SERVE_PID=$!
for i in $(seq 1 40); do curl -sf http://localhost:18600/api/health && break; sleep 1; done
curl -sf http://localhost:18600/api/health && echo " HEALTH_OK" || (cat /tmp/api.serve.log; exit 1)
kill $SERVE_PID 2>/dev/null
```
Expected: `{"status":"ok"} HEALTH_OK`.

- [ ] **Step 10: Commit**

```bash
git add . && git commit -m "feat(api): global prefix, cors, config validation, health endpoint

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: api — ClerkGuard (TDD)

**Files:** `apps/api/src/clerk/clerk.guard.ts`, `clerk.module.ts`, `clerk.guard.spec.ts`.

- [ ] **Step 1: Install @clerk/backend**

```bash
pnpm add @clerk/backend
```

- [ ] **Step 2: Write failing test** — `apps/api/src/clerk/clerk.guard.spec.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { ClerkGuard } from './clerk.guard';

vi.mock('@clerk/backend', () => ({ verifyToken: vi.fn() }));
import { verifyToken } from '@clerk/backend';
const mockedVerify = vi.mocked(verifyToken);

const makeCtx = (authHeader?: string): ExecutionContext => {
  const req: any = { headers: {} };
  if (authHeader !== undefined) req.headers.authorization = authHeader;
  return { switchToHttp: () => ({ getRequest: () => req }) } as any;
};

describe('ClerkGuard', () => {
  beforeEach(() => mockedVerify.mockReset());

  it('rejects missing Authorization header', async () => {
    await expect(new ClerkGuard().canActivate(makeCtx())).rejects.toThrow('Missing Bearer token');
  });
  it('rejects empty token', async () => {
    await expect(new ClerkGuard().canActivate(makeCtx('Bearer '))).rejects.toThrow('Empty Bearer token');
  });
  it('sets req.user + allows on valid token', async () => {
    mockedVerify.mockResolvedValue({ sub: 'user_123', sid: 'sess_1' } as any);
    const ctx = makeCtx('Bearer valid.jwt');
    await expect(new ClerkGuard().canActivate(ctx)).resolves.toBe(true);
    expect((ctx.switchToHttp().getRequest() as any).user).toBe('user_123');
  });
  it('rejects when verifyToken throws', async () => {
    mockedVerify.mockRejectedValue(new Error('bad'));
    await expect(new ClerkGuard().canActivate(makeCtx('Bearer bad'))).rejects.toThrow('Invalid or expired Clerk session token');
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
pnpm nx run api:test
```

- [ ] **Step 4: Implement guard** — `apps/api/src/clerk/clerk.guard.ts`

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import type { Request } from 'express';

const AUTHORIZED_PARTIES = (process.env.CLERK_AUTHORIZED_PARTIES ?? 'http://localhost:18601')
  .split(',').map((s) => s.trim()).filter(Boolean);

export interface AuthenticatedRequest extends Request {
  user?: string;
  clerkSessionId?: string;
}

@Injectable()
export class ClerkGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing Bearer token');
    const token = header.slice('Bearer '.length).trim();
    if (!token) throw new UnauthorizedException('Empty Bearer token');
    try {
      const verified = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY,
        jwtKey: process.env.CLERK_JWT_KEY,
        authorizedParties: AUTHORIZED_PARTIES,
      });
      req.user = verified.sub;
      req.clerkSessionId = verified.sid;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired Clerk session token');
    }
  }
}
```

- [ ] **Step 5: Module** — `apps/api/src/clerk/clerk.module.ts`

```ts
import { Module } from '@nestjs/common';
import { ClerkGuard } from './clerk.guard';

@Module({ providers: [ClerkGuard], exports: [ClerkGuard] })
export class ClerkModule {}
```

- [ ] **Step 6: Run — expect PASS**

```bash
pnpm nx run api:test
```

- [ ] **Step 7: Commit**

```bash
git add . && git commit -m "feat(api): clerk jwt guard via @clerk/backend verifyToken

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: api — MeController (TDD)

**Files:** `apps/api/src/me/me.controller.ts` + spec; update `app.module.ts`.

- [ ] **Step 1: Write failing test** — `apps/api/src/me/me.controller.spec.ts`

```ts
import { describe, it, expect } from 'vitest';
import { MeController } from './me.controller';

describe('MeController', () => {
  it('returns clerkUserId from req.user', () => {
    expect(new MeController().me({ user: 'user_abc' } as any)).toEqual({ clerkUserId: 'user_abc' });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm nx run api:test
```

- [ ] **Step 3: Implement** — `apps/api/src/me/me.controller.ts`

```ts
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { MeResponseSchema } from '@linkz/shared';
import { ClerkGuard, AuthenticatedRequest } from '../clerk/clerk.guard';

@Controller('me')
@UseGuards(ClerkGuard)
export class MeController {
  @Get()
  me(@Req() req: AuthenticatedRequest) {
    return MeResponseSchema.parse({ clerkUserId: req.user });
  }
}
```

- [ ] **Step 4: Register in app.module.ts**

Add imports `ClerkModule` and `MeController`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { apiEnvSchema } from '@linkz/config';
import { HealthController } from '../health/health.controller';
import { MeController } from '../me/me.controller';
import { ClerkModule } from '../clerk/clerk.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: (env) => apiEnvSchema.parse(env) }),
    ClerkModule,
  ],
  controllers: [HealthController, MeController],
})
export class AppModule {}
```

- [ ] **Step 5: Run — expect PASS**

```bash
pnpm nx run api:test
```

- [ ] **Step 6: Commit**

```bash
git add . && git commit -m "feat(api): protected /api/me endpoint

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: libs/database + api DrizzleModule (TDD, no schema)

**Files:** `libs/database/drizzle.config.ts`, `src/client.ts`, `src/schema/index.ts`, `src/index.ts`, `src/client.spec.ts`; `apps/api/src/drizzle/drizzle.{module,service}.ts`; update `app.module.ts`.

- [ ] **Step 1: Generate lib + install deps**

```bash
pnpm dlx nx g @nx/js:library libs/database --bundler=none --importPath=@linkz/database \
  --unitTestRunner=vitest --linter=eslint --strict --tags=scope:database,type:data-access
pnpm add drizzle-orm postgres
pnpm add -D drizzle-kit dotenv
```

- [ ] **Step 2: Write failing test** — `libs/database/src/client.spec.ts`

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('postgres', () => ({ default: vi.fn(() => vi.fn()) }));
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: vi.fn((c, opts: any) => ({ __db: true, client: c, opts })) }));

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createDb } from './client';

describe('createDb', () => {
  it('wires postgres + drizzle with schema', () => {
    const { db, client } = createDb('postgres://u:p@localhost:18602/linkz');
    expect(postgres).toHaveBeenCalledWith('postgres://u:p@localhost:18602/linkz');
    expect(drizzle).toHaveBeenCalledWith(client, expect.objectContaining({ schema: expect.any(Object) }));
    expect((db as any).__db).toBe(true);
  });
});

describe('getDb (lazy)', () => {
  it('throws when DATABASE_URL missing', async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();
    const { getDb } = await import('./client');
    expect(() => getDb()).toThrow('DATABASE_URL is not set');
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
pnpm nx run database:test
```

- [ ] **Step 4: Implement client** — `libs/database/src/client.ts`

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type DbClient = ReturnType<typeof createDb>;

export function createDb(url: string) {
  const client = postgres(url);
  return { db: drizzle(client, { schema }), client };
}

let _instance: DbClient | undefined;
export function getDb(): DbClient {
  if (!_instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    _instance = createDb(url);
  }
  return _instance;
}
```

- [ ] **Step 5: Empty schema barrel** — `libs/database/src/schema/index.ts`

```ts
// Schema barrel — intentionally empty for the skeleton.
// Table definitions (seats, users, reservations, payments, webhook ledger, outbox, invoices, tickets)
// land in a later task.
export {};
```

- [ ] **Step 6: Public entry** — `libs/database/src/index.ts`

```ts
export { createDb, getDb } from './client';
export type { DbClient } from './client';
```

- [ ] **Step 7: drizzle config** — `libs/database/drizzle.config.ts`

```ts
import dotenv from 'dotenv';
import { defineConfig } from 'drizzle-kit';

dotenv.config({ path: '../../.env' });

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL! },
  migrations: { table: '__drizzle_migrations__', schema: 'public' },
});
```

- [ ] **Step 8: Add db targets to `libs/database/project.json`**

```jsonc
"db-generate": { "executor": "nx:run-commands", "options": { "command": "drizzle-kit generate --config=drizzle.config.ts", "cwd": "libs/database" } },
"db-migrate":  { "executor": "nx:run-commands", "options": { "command": "drizzle-kit migrate --config=drizzle.config.ts", "cwd": "libs/database" } },
"db-push":     { "executor": "nx:run-commands", "options": { "command": "drizzle-kit push --config=drizzle.config.ts", "cwd": "libs/database" } },
"db-studio":   { "executor": "nx:run-commands", "options": { "command": "drizzle-kit studio --config=drizzle.config.ts", "cwd": "libs/database" } }
```

- [ ] **Step 9: Run db:generate (no-op, no DB needed)**

```bash
pnpm nx run database:db-generate
```
Expected: `No schema changes, nothing to migrate 😴` (exit 0); creates `libs/database/drizzle/meta/_journal.json`.

- [ ] **Step 10: Run test — expect PASS**

```bash
pnpm nx run database:test
```

- [ ] **Step 11: api DrizzleModule** — `apps/api/src/drizzle/drizzle.service.ts`

```ts
import { Injectable } from '@nestjs/common';
import { getDb } from '@linkz/database';

@Injectable()
export class DrizzleService {
  private _db = getDb();
  get db() { return this._db.db; }
  get client() { return this._db.client; }
}
```

`apps/api/src/drizzle/drizzle.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DrizzleService } from './drizzle.service';

@Module({ providers: [DrizzleService], exports: [DrizzleService] })
export class DrizzleModule {}
```

- [ ] **Step 12: Register DrizzleModule in app.module.ts** (add to `imports`)

- [ ] **Step 13: Run api tests — expect PASS**

```bash
pnpm nx run api:test
```
Note: importing DrizzleModule calls `getDb()` lazily inside the service factory, not at import. If a test instantiates DrizzleService without `DATABASE_URL`, set `DATABASE_URL=postgres://linkz:linkz@localhost:18602/linkz` in the api vitest setup env. Add to `apps/api` vitest config `env` if needed.

- [ ] **Step 14: Commit**

```bash
git add . && git commit -m "feat(database): drizzle+postgres-js wiring (no schema) + api drizzle module

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: Scaffold SolidJS web app + verify boot

**Files:** `apps/web/` (project.json, vite.config.ts, tsconfig*, src/).

- [ ] **Step 1: Scaffold Vite solid-ts into apps/web**

```bash
pnpm create vite@latest apps/web --template solid-ts
```
Expected: `apps/web/` with `package.json`, `vite.config.ts`, `src/App.tsx`, `src/index.tsx`, tsconfig*.

- [ ] **Step 2: Hoist deps — delete app-local package.json + install at root**

```bash
rm -f apps/web/package.json
pnpm add solid-js
pnpm add -D vite vite-plugin-solid @nx/vite @nx/vitest vitest jsdom @solidjs/testing-library
```

- [ ] **Step 3: Write vite.config.ts** — `apps/web/vite.config.ts`

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig({
  cacheDir: '../../node_modules/.vite/web',
  server: {
    port: 18601,
    proxy: { '/api': 'http://localhost:18600' },
  },
  build: { target: 'esnext', outDir: '../../dist/apps/web' },
  plugins: [nxViteTsPaths(), solidPlugin()],
  test: {
    globals: true,
    cache: { dir: '../../node_modules/.vitest' },
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
  },
});
```

- [ ] **Step 4: Write project.json** — `apps/web/project.json`

```json
{
  "name": "web",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "projectType": "application",
  "sourceRoot": "apps/web/src",
  "tags": ["scope:web", "type:app"],
  "targets": {
    "build": {
      "executor": "@nx/vite:build",
      "outputs": ["{options.outputPath}"],
      "defaultConfiguration": "production",
      "options": { "outputPath": "dist/apps/web", "configFile": "apps/web/vite.config.ts" },
      "configurations": {
        "development": { "mode": "development" },
        "production": { "mode": "production" }
      }
    },
    "serve": {
      "executor": "@nx/vite:dev-server",
      "defaultConfiguration": "development",
      "options": { "buildTarget": "web:build:development", "port": 18601 },
      "configurations": {
        "development": { "buildTarget": "web:build:development", "hmr": true },
        "production": { "buildTarget": "web:build:production", "hmr": false }
      }
    },
    "preview": { "executor": "@nx/vite:preview-server", "options": { "buildTarget": "web:build" } },
    "test": {
      "executor": "@nx/vitest:test",
      "outputs": ["{workspaceRoot}/coverage/apps/web"],
      "options": { "configFile": "apps/web/vite.config.ts", "passWithNoTests": true }
    },
    "lint": { "executor": "@nx/eslint:lint", "outputs": ["{options.outputFile}"], "options": { "lintFilePatterns": ["apps/web/**/*.{ts,tsx}"] } }
  }
}
```

- [ ] **Step 5: Fix tsconfig to extend base + Solid JSX** — `apps/web/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "types": ["vite/client"]
  },
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.spec.json" }
  ]
}
```
Ensure `tsconfig.app.json` and `tsconfig.spec.json` also extend `../../tsconfig.base.json` (keep their existing `include`/`exclude`).

- [ ] **Step 6: Verify build**

```bash
pnpm nx run web:build
```
Expected: build succeeds, output in `dist/apps/web`.

- [ ] **Step 7: Verify serve boots on 18601**

```bash
pnpm nx run web:serve > /tmp/web.serve.log 2>&1 &
WEB_PID=$!
for i in $(seq 1 40); do curl -sf http://localhost:18601 && break; sleep 1; done
curl -sf http://localhost:18601 >/dev/null && echo "WEB_BOOT_OK" || (cat /tmp/web.serve.log; exit 1)
kill $WEB_PID 2>/dev/null
```
Expected: `WEB_BOOT_OK`.

- [ ] **Step 8: Commit**

```bash
git add . && git commit -m "chore: scaffold solidjs+vite web app in nx

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: web — clerk auth helpers (TDD)

**Files:** `apps/web/src/clerk/auth.ts` + `auth.spec.ts`.

- [ ] **Step 1: Install @clerk/clerk-js**

```bash
pnpm add @clerk/clerk-js
```

- [ ] **Step 2: Write failing test** — `apps/web/src/clerk/auth.spec.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { deriveAuth, fetchMe } from './auth';

describe('deriveAuth', () => {
  it('signed-out when no session', () => {
    const a = deriveAuth({ client: { signedIn: false }, user: undefined, session: undefined } as any);
    expect(a.isSignedIn).toBe(false);
    expect(a.userId).toBeNull();
    expect(a.getToken()).resolves.toBeNull();
  });
  it('signed-in with userId + getToken', () => {
    const a = deriveAuth({ client: { signedIn: true }, user: { id: 'u1' }, session: { getToken: () => Promise.resolve('jwt') } } as any);
    expect(a.isSignedIn).toBe(true);
    expect(a.userId).toBe('u1');
    expect(a.getToken()).resolves.toBe('jwt');
  });
});

describe('fetchMe', () => {
  it('sends Bearer token + returns clerkUserId', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: () => Promise.resolve({ clerkUserId: 'u1' }) } as any);
    const out = await fetchMe(() => Promise.resolve('jwt'));
    expect(out).toEqual({ clerkUserId: 'u1' });
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

- [ ] **Step 3: Run — expect FAIL**

```bash
pnpm nx run web:test
```

- [ ] **Step 4: Implement** — `apps/web/src/clerk/auth.ts`

```ts
import type Clerk from '@clerk/clerk-js';

export interface AuthState {
  isSignedIn: boolean;
  userId: string | null;
  getToken: () => Promise<string | null>;
}

export function deriveAuth(clerk: Clerk): AuthState {
  return {
    isSignedIn: !!clerk.client?.signedIn,
    userId: clerk.user?.id ?? null,
    getToken: () => (clerk.session ? clerk.session.getToken() : Promise.resolve(null)),
  };
}

export async function fetchMe(getToken: () => Promise<string | null): Promise<{ clerkUserId: string }> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`me request failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 5: Run — expect PASS**

```bash
pnpm nx run web:test
```

- [ ] **Step 6: Commit**

```bash
git add . && git commit -m "feat(web): clerk auth helpers (deriveAuth, fetchMe)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 12: web — ClerkProvider + UI components

**Files:** `apps/web/src/clerk/ClerkContext.tsx`, `components.tsx`.

- [ ] **Step 1: ClerkContext** — `apps/web/src/clerk/ClerkContext.tsx`

```tsx
import { createContext, useContext, createSignal, onMount, onCleanup, type ParentProps } from 'solid-js';
import Clerk from '@clerk/clerk-js';
import { deriveAuth, type AuthState } from './auth';

interface ClerkCtxValue { clerk: Clerk; auth: () => AuthState; }
const ClerkCtx = createContext<ClerkCtxValue>();

export function ClerkProvider(props: ParentProps<{ publishableKey: string }>) {
  const clerk = new Clerk(props.publishableKey);
  const [auth, setAuth] = createSignal<AuthState>({
    isSignedIn: false, userId: null, getToken: () => Promise.resolve(null),
  });
  const sync = () => setAuth(deriveAuth(clerk));
  onMount(async () => { await clerk.load(); sync(); clerk.addListener(sync); });
  onCleanup(() => clerk.removeListener?.(sync));
  return <ClerkCtx.Provider value={{ clerk, auth }}>{props.children}</ClerkCtx.Provider>;
}

export function useClerk(): ClerkCtxValue {
  const ctx = useContext(ClerkCtx);
  if (!ctx) throw new Error('useClerk must be used within ClerkProvider');
  return ctx;
}
```

- [ ] **Step 2: Components** — `apps/web/src/clerk/components.tsx`

```tsx
import { Show, type ParentProps } from 'solid-js';
import { useClerk } from './ClerkContext';

export function SignedIn(props: ParentProps) {
  const { auth } = useClerk();
  return <Show when={auth().isSignedIn}>{props.children}</Show>;
}

export function SignedOut(props: ParentProps) {
  const { auth } = useClerk();
  return <Show when={!auth().isSignedIn}>{props.children}</Show>;
}

export function SignInButton() {
  const { clerk } = useClerk();
  return <button onClick={() => clerk.openSignIn()}>Sign in</button>;
}

export function SignOutButton() {
  const { clerk } = useClerk();
  return <button onClick={() => clerk.signOut()}>Sign out</button>;
}
```

- [ ] **Step 3: Verify build (compile-check)**

```bash
pnpm nx run web:build
```
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add . && git commit -m "feat(web): clerk provider + signed-in/out + sign in/out components

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 13: web — App UI wiring (uses auth + fetchMe)

**Files:** `apps/web/src/App.tsx`, `.env.local`.

- [ ] **Step 1: App.tsx** — `apps/web/src/App.tsx`

```tsx
import { createSignal, Show, type Component } from 'solid-js';
import { ClerkProvider, useClerk } from './clerk/ClerkContext';
import { SignedIn, SignedOut, SignInButton, SignOutButton } from './clerk/components';
import { fetchMe } from './clerk/auth';

const Inner: Component = () => {
  const { auth } = useClerk();
  const [me, setMe] = createSignal<{ clerkUserId: string } | null>(null);
  const [err, setErr] = createSignal<string | null>(null);

  const loadMe = async () => {
    try { setMe(await fetchMe(auth().getToken)); setErr(null); }
    catch (e) { setErr(String((e as Error).message)); }
  };

  return (
    <main>
      <h1>Linkz</h1>
      <SignedOut>
        <p>You are signed out.</p>
        <SignInButton />
      </SignedOut>
      <SignedIn>
        <p>Welcome, {auth().userId}</p>
        <SignOutButton />
        <button onClick={loadMe}>Fetch /api/me</button>
        <Show when={me()}><pre>{JSON.stringify(me())}</pre></Show>
        <Show when={err()}><pre style="color:red">{err()}</pre></Show>
      </SignedIn>
    </main>
  );
};

const App: Component = () => {
  const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
  if (!key) return <main style="color:red">Missing VITE_CLERK_PUBLISHABLE_KEY</main>;
  return (
    <ClerkProvider publishableKey={key}>
      <Inner />
    </ClerkProvider>
  );
};

export default App;
```

- [ ] **Step 2: .env.example for web** — `apps/web/.env.example`

```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_replace_me
```

- [ ] **Step 3: Verify build**

```bash
pnpm nx run web:build
pnpm nx run web:test
```
Expected: build OK; tests pass (auth helpers from Task 11).

- [ ] **Step 4: Commit**

```bash
git add . && git commit -m "feat(web): app shell with clerk auth + /api/me fetch

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 14: Dev infra — docker-compose, .env.example, README

**Files:** `docker-compose.yml`, `.env.example`, `README.md`.

- [ ] **Step 1: docker-compose.yml**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: linkz
      POSTGRES_PASSWORD: linkz
      POSTGRES_DB: linkz
    ports:
      - "18602:5432"
    volumes:
      - linkz_pg:/var/lib/postgresql/data
    healthcheck:
      test: ["pg_isready", "-U", "linkz", "-d", "linkz"]
      interval: 5s
      timeout: 5s
      retries: 10
volumes:
  linkz_pg:
```

- [ ] **Step 2: root .env.example**

```
# API
NODE_ENV=development
PORT=18600
CORS_ORIGIN=http://localhost:18601
DATABASE_URL=postgres://linkz:linkz@localhost:18602/linkz
CLERK_SECRET_KEY=sk_test_replace_me
CLERK_JWT_KEY=
CLERK_AUTHORIZED_PARTIES=http://localhost:18601

# Web (apps/web/.env.local)
# VITE_CLERK_PUBLISHABLE_KEY=pk_test_replace_me
```

- [ ] **Step 3: README.md**

```markdown
# Linkz

Seat-reservation platform — Nx monorepo (NestJS + SolidJS), Clerk auth, Postgres + Drizzle.

## Prerequisites
- Node 26 (see .nvmrc)
- pnpm 11+
- Docker (for local Postgres)

## Setup
1. `pnpm install`
2. `cp .env.example .env` and fill Clerk keys (see below)
3. `cp apps/web/.env.example apps/web/.env.local` and fill `VITE_CLERK_PUBLISHABLE_KEY`
4. `docker compose up -d`            # Postgres on host port 18602
5. `pnpm nx run database:db-push`    # apply schema (no-op until schema task lands)

## Run
- API:  `pnpm nx run api:serve`      # http://localhost:18600/api
- Web:  `pnpm nx run web:serve`      # http://localhost:18601  (proxies /api → :18600)

## Ports
| Service  | Port  |
|----------|-------|
| API      | 18600 |
| Web      | 18601 |
| Postgres | 18602 |

## Clerk setup
1. Create a Clerk app at clerk.com.
2. Copy **Secret key** → `CLERK_SECRET_KEY`; **Publishable key** → `VITE_CLERK_PUBLISHABLE_KEY`.
3. (Optional, networkless verify) Dashboard > API Keys > **JWKS Public Key (PEM)** → `CLERK_JWT_KEY`.
4. **Session lifetime**: Dashboard > Sessions > Maximum lifetime = **90 days**.
5. SPA OAuth: mark the OAuth app **Public** (PKCE S256, token auth method `none`). Add `http://localhost:18601` to authorized origins / `authorizedParties`.

## Scripts
- `pnpm nx run api:test` / `web:test` / `<lib>:test`
- `pnpm nx run-many -t build` / `-t lint` / `-t test`
- `pnpm nx run database:db-generate` / `db-migrate` / `db-push` / `db-studio`

## Architecture
See `arch/model.c4` (LikeC4) for the system landscape and reservation saga.
```

- [ ] **Step 4: Ensure .gitignore covers env**

Confirm root `.gitignore` (created by Nx) includes `.env`, `.env.local`, `dist`, `node_modules`. Append if missing:

```
.env
.env.*
!.env.example
```

- [ ] **Step 5: Commit**

```bash
git add . && git commit -m "chore: docker-compose, env examples, README

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 15: End-to-end verification + final gates

- [ ] **Step 1: Postgres up**

```bash
docker compose up -d
for i in $(seq 1 30); do docker compose ps postgres | grep -q healthy && break; sleep 1; done
docker compose ps
```
Expected: postgres healthy.

- [ ] **Step 2: Lint all**

```bash
pnpm nx run-many -t lint
```
Expected: all PASS.

- [ ] **Step 3: Test all**

```bash
pnpm nx run-many -t test
```
Expected: all PASS (api, web, shared, config, database).

- [ ] **Step 4: Build all**

```bash
pnpm nx run-many -t build
```
Expected: api + web build OK.

- [ ] **Step 5: API boots + health**

```bash
set -a; . ./.env; set +a
pnpm nx run api:serve > /tmp/api.serve.log 2>&1 &
API_PID=$!
for i in $(seq 1 40); do curl -sf http://localhost:18600/api/health && break; sleep 1; done
curl -sf http://localhost:18600/api/health && echo " HEALTH_OK"
curl -s -o /dev/null -w "%{http_code}" http://localhost:18600/api/me  # expect 401 (no token)
kill $API_PID 2>/dev/null
```
Expected: `{"status":"ok"} HEALTH_OK`; `/api/me` without token returns 401.

- [ ] **Step 6: Web boots**

```bash
pnpm nx run web:serve > /tmp/web.serve.log 2>&1 &
WEB_PID=$!
for i in $(seq 1 40); do curl -sf http://localhost:18601 && break; sleep 1; done
curl -sf http://localhost:18601 >/dev/null && echo "WEB_BOOT_OK"
kill $WEB_PID 2>/dev/null
```
Expected: `WEB_BOOT_OK`.

- [ ] **Step 7: Drizzle generate no-op**

```bash
set -a; . ./.env; set +a
pnpm nx run database:db-generate
```
Expected: no-op, exit 0.

- [ ] **Step 8: Manual e2e (documented — requires real Clerk keys)**

With `.env` + `apps/web/.env.local` filled: `pnpm nx run api:serve` + `pnpm nx run web:serve`, sign in at http://localhost:18601, click "Fetch /api/me" → renders `{ clerkUserId: "..." }` proving the Bearer-token guard accepts a real Clerk session.

- [ ] **Step 9: Final commit**

```bash
git add . && git commit -m "chore: verify skeleton e2e (lint/test/build/serve)

Co-Authored-By: Claude <noreply@anthropic.com>" || echo "nothing to commit"
```

---

## Self-Review notes

- Spec coverage: Nx+Nest+Solid+Clerk+Drizzle wiring ✓; no-schema constraint ✓; 186xx ports ✓; TDD per unit ✓; README+env+docker ✓; verification ✓.
- `@clerk/clerk-solid` absent → `@clerk/clerk-js` wrapped (spec fallback) ✓.
- Open risk: `@nx/nest:application --unitTestRunner=vitest` generated vitest config shape — verified by running `api:test` in Task 3 Step 2; if it fails, regenerate with `--unitTestRunner=jest` and adapt specs to jest. Risk: `apps/web` tsconfig from create-vite template — overridden in Task 10 Step 5.
- `getDb()` laziness avoids import-time DB connection in tests ✓.