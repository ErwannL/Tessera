#!/bin/sh
# Starts the development stack (Tessera + PostgreSQL, and the demo App with --profile demo).
set -eu
cd "$(dirname "$0")/.."
sh scripts/init-env.sh
docker compose "$@" up --build -d
echo "Tessera dashboard: http://localhost:${TESSERA_PORT:-3000}"
case "$*" in *demo*) echo "Demo App:          http://localhost:${DEMO_PORT:-4000}" ;; esac
