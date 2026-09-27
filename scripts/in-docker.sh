#!/bin/sh
# Runs a command in the tooling image next to a disposable PostgreSQL, then removes
# every test container and volume, whether the command succeeded or not.
set -u
cd "$(dirname "$0")/.."
compose() { docker compose -f docker-compose.test.yml -p tessera-test "$@"; }
cleanup() { compose down -v --remove-orphans >/dev/null 2>&1; }
trap cleanup EXIT INT TERM
compose build tools || exit 1
compose run --rm tools "$@"
