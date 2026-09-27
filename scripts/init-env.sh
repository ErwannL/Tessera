#!/bin/sh
# Creates .env for local development from .env.example, with freshly generated secrets.
# Never overwrites an existing .env.
set -eu
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  exit 0
fi
rand() { sh scripts/random.sh 48; }
api_key=$(rand)
pg_password=$(rand)
sed \
  -e "s|^API_KEYS=.*|API_KEYS=${api_key}|" \
  -e "s|^DEMO_API_KEY=.*|DEMO_API_KEY=${api_key}|" \
  -e "s|^CODE_HMAC_KEY=.*|CODE_HMAC_KEY=$(rand)|" \
  -e "s|^HANDOFF_SECRET=.*|HANDOFF_SECRET=$(rand)|" \
  -e "s|^SESSION_SECRET=.*|SESSION_SECRET=$(rand)|" \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${pg_password}|" \
  -e "s|^DATABASE_URL=.*|DATABASE_URL=postgres://tessera:${pg_password}@postgres:5432/tessera|" \
  .env.example >.env
echo "Created .env with generated development secrets."
