#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/docker.sh
qft_select_docker
test -f .env || { echo "Run scripts/generate-env.sh first" >&2; exit 1; }
export COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-1}"
qft_docker compose config --quiet
qft_docker compose pull postgres
qft_docker compose build
qft_docker compose up -d --remove-orphans
qft_docker compose ps
