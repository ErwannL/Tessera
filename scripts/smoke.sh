#!/bin/sh
# Checks the production image: it runs as a non-root user, applies migrations, starts,
# and answers /health. Everything is removed afterwards.
set -u
cd "$(dirname "$0")/.."
IMAGE=${TESSERA_IMAGE:-tessera:latest}
NAME=tessera-smoke
cleanup() {
  docker rm -f "$NAME-app" "$NAME-db" >/dev/null 2>&1
  docker network rm "$NAME" >/dev/null 2>&1
}
trap cleanup EXIT INT TERM
user=$(docker run --rm --entrypoint id "$IMAGE" -u) || exit 1
if [ "$user" = "0" ]; then
  echo "The image runs as root" >&2
  exit 1
fi
docker network create "$NAME" >/dev/null || exit 1
docker run -d --name "$NAME-db" --network "$NAME" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null || exit 1
for _ in $(seq 1 60); do
  docker exec "$NAME-db" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
set -- \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgres://postgres@$NAME-db:5432/postgres" \
  -e API_KEYS="$(sh scripts/random.sh)" \
  -e CODE_HMAC_KEY="$(sh scripts/random.sh)" \
  -e HANDOFF_SECRET="$(sh scripts/random.sh)" \
  -e SESSION_SECRET="$(sh scripts/random.sh)" \
  -e PUBLIC_URL=https://tessera.example.com \
  -e TRUST_PROXY=false
docker run --rm --network "$NAME" "$@" "$IMAGE" migrate || exit 1
docker run -d --name "$NAME-app" --network "$NAME" "$@" "$IMAGE" >/dev/null || exit 1
for _ in $(seq 1 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$NAME-app" 2>/dev/null)
  [ "$status" = "healthy" ] && break
  sleep 2
done
docker exec "$NAME-app" node -e "fetch('http://127.0.0.1:3000/health').then(async (r) => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1); }, () => process.exit(1))" || exit 1
echo "Smoke test passed: non-root user $user, migrations applied, /health OK, container $status."
