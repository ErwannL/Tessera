#!/bin/sh
# Builds the production image, starts a disposable stack (PostgreSQL, Tessera, demo App),
# runs Playwright against it, then tears everything down (containers and volumes).
set -u
cd "$(dirname "$0")/.."
E2E_API_KEY=$(sh scripts/random.sh)
E2E_CODE_HMAC_KEY=$(sh scripts/random.sh)
E2E_HANDOFF_SECRET=$(sh scripts/random.sh)
E2E_SESSION_SECRET=$(sh scripts/random.sh)
export E2E_API_KEY E2E_CODE_HMAC_KEY E2E_HANDOFF_SECRET E2E_SESSION_SECRET
compose() { docker compose -f docker-compose.e2e.yml -p tessera-e2e "$@"; }
cleanup() { compose down -v --remove-orphans >/dev/null 2>&1; }
trap cleanup EXIT INT TERM
compose build || exit 1
compose run --rm playwright
