#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/docker.sh
qft_select_docker

restore_production_profile() {
  local status=$?
  unset BROWSER_ALLOW_PRIVATE_NETWORKS
  qft_docker compose --profile acceptance stop mock-model >/dev/null 2>&1 || true
  scripts/cleanup-acceptance.sh --apply >/dev/null 2>&1 || status=1
  qft_docker compose up -d --force-recreate --wait browser-worker >/dev/null 2>&1 || status=1
  scripts/smoke.sh || status=1
  return "$status"
}
trap restore_production_profile EXIT
trap 'exit 130' INT TERM

acceptance_compose=(
  compose
  -f compose.yaml
  -f tests/compose.acceptance.yaml
  --profile acceptance
)
qft_docker "${acceptance_compose[@]}" up -d --force-recreate browser-worker mock-model
qft_docker "${acceptance_compose[@]}" run --rm acceptance
