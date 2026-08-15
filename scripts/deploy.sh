#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test -f .env || { echo "Run scripts/generate-env.sh first" >&2; exit 1; }
export COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-1}"
docker compose config --quiet
docker compose pull postgres
docker compose build
docker compose up -d --remove-orphans
docker compose ps

