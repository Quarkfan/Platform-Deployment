#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
scripts/release-preflight.sh --deploy
. scripts/lib/docker.sh
qft_select_docker
export COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-1}"
qft_docker compose pull postgres
qft_docker compose build
qft_docker compose up -d --remove-orphans
qft_docker compose ps
