#!/usr/bin/env bash
# Linkz — one-command local dev boot.
#
#   pnpm dev   (or: bash scripts/dev.sh)
#
# Boots everything in the right order and tears it all down on Ctrl-C:
#   1. install deps + copy env templates if missing
#   2. start Postgres (docker compose, port 18602) and wait for it
#   3. sync the DB schema (drizzle push)
#   4. start `stripe listen`, capture the printed whsec_… signing secret
#      and write it into .env as STRIPE_WEBHOOK_SECRET (auto, no paste)
#   5. run, concurrently:  API (:18600) · web (:18601), with the live secret
#
# Layout — apps live at the repo root (not under apps/):
#   api/   NestJS API  ·  web/  SolidJS SPA  ·  libs/database  (drizzle)
#   .env             API env (Clerk/Stripe/DB)  — sourced into the API child
#   web/.env.local   SPA env (VITE_CLERK_PUBLISHABLE_KEY)  — guarded below
#
# Requires the Stripe CLI installed + `stripe login` run once.
# To skip Stripe entirely, set PAYMENT_PROVIDER=test in .env (the test
# provider marks payments succeeded on redirect, no webhook needed) and
# stop the listener — this script still starts `stripe listen` by default.

set -euo pipefail

cd "$(dirname "$0")/.."   # repo root
ROOT="$(pwd)"
readonly ROOT

# --- prerequisites ----------------------------------------------------------
require() {  # require <bin> <hint>
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "✗ '$1' not found. $2" >&2
    exit 1
  fi
}
require pnpm   "Install Node + pnpm first."
require docker "Start Docker Desktop first."
require stripe "Install the Stripe CLI: brew install stripe/stripe-cli/stripe"

# --- env templates (copy if missing, never overwrite) -----------------------
[ -f .env ]                 || cp .env.example .env
[ -f web/.env.local ]  || cp web/.env.example web/.env.local

# Guard the Clerk publishable key — the web app hard-fails without a real one
# (see web/src/App.tsx). Can't be auto-captured; must come from clerk.com.
WEB_ENV="web/.env.local"
web_pk="$(grep -E '^VITE_CLERK_PUBLISHABLE_KEY=' "$WEB_ENV" | head -1 | cut -d= -f2-)"
case "$web_pk" in
  ""|pk_test_replace_me)
    echo "✗ VITE_CLERK_PUBLISHABLE_KEY in $WEB_ENV is still the placeholder." >&2
    echo "  Copy your Clerk Publishable key (clerk.com → API Keys → Publishable key)" >&2
    echo "  into $WEB_ENV, then re-run pnpm dev." >&2
    exit 1
    ;;
esac
echo "✓ Clerk publishable key present in $WEB_ENV"

# load the current API env so later steps (and the NestJS child) inherit it
set -a; . ./.env; set +a

# --- one-shot setup ---------------------------------------------------------
echo "› pnpm install"
pnpm install

echo "› docker compose up -d (Postgres :18602)"
docker compose up -d

echo "› waiting for Postgres to accept connections…"
until docker compose exec -T postgres pg_isready -U linkz -d linkz >/dev/null 2>&1; do
  sleep 0.5
done
echo "✓ Postgres ready"

echo "› drizzle push (sync schema)"
pnpm nx run @linkz/database:db-push

# --- Stripe listener + auto-capture the webhook signing secret --------------
STRIPE_LOG="$(mktemp -t linkz-stripe.XXXXXX.log)"
readonly STRIPE_LOG

PIDS=()
cleanup() {
  echo
  echo "› shutting down…"
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  rm -f "$STRIPE_LOG"
}
trap cleanup EXIT INT TERM

echo "› stripe listen --forward-to localhost:18600/api/payments/webhook"
stripe listen --forward-to localhost:18600/api/payments/webhook >"$STRIPE_LOG" 2>&1 &
PIDS+=("$!")

# wait for the listener to print its signing secret (or exit early)
secret=""
for _ in $(seq 1 60); do
  if ! kill -0 "${PIDS[0]}" 2>/dev/null; then
    echo "✗ stripe listen exited early:" >&2
    cat "$STRIPE_LOG" >&2
    exit 1
  fi
  secret="$(grep -m1 -oE 'whsec_[A-Za-z0-9]+' "$STRIPE_LOG" || true)"
  [ -n "$secret" ] && break
  sleep 0.5
done

if [ -z "$secret" ]; then
  echo "✗ timed out waiting for the Stripe webhook secret:" >&2
  cat "$STRIPE_LOG" >&2
  exit 1
fi

# write the captured secret into .env (replace existing line, or append)
set_env_var() {  # set_env_var <key> <value> <file>
  local key="$1" val="$2" file="$3"
  if grep -qE "^${key}=" "$file"; then
    sed -i.bak "s|^${key}=.*|${key}=${val}|" "$file" && rm -f "$file.bak"
  else
    printf '\n%s=%s\n' "$key" "$val" >>"$file"
  fi
}

if [ "${STRIPE_WEBHOOK_SECRET:-}" != "$secret" ]; then
  set_env_var STRIPE_WEBHOOK_SECRET "$secret" .env
  echo "✓ captured webhook signing secret → wrote STRIPE_WEBHOOK_SECRET in .env"
  # re-source so the API process inherits the fresh secret
  set -a; . ./.env; set +a
else
  echo "✓ Stripe webhook secret already up to date in .env"
fi

# stream the (already-running) listener logs to the console, prefixed
tail -n +1 -f "$STRIPE_LOG" | sed 's/^/[stripe] /' &
PIDS+=("$!")

# --- concurrent long-runners -----------------------------------------------
# run <label> <cmd...>  — background, stdout/stderr line-prefixed with the label
run() {
  local label="$1"; shift
  "$@" > >(sed "s/^/[$label] /") 2>&1 &
  PIDS+=("$!")
}

echo "› starting API · web  (Ctrl-C to stop)"
run api pnpm nx run api:serve
run web pnpm nx run web:serve

wait