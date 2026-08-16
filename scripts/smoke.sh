#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/docker.sh
qft_select_docker

services=(message-gateway context-hub model-hub capability-registry runtime-center scheduler-center resource-center governance-center browser-worker capability-worker console)
edge_container="$(qft_docker compose ps -q edge 2>/dev/null || true)"
if [[ -n "$edge_container" ]]; then
  services+=(edge)
fi
for service in "${services[@]}"; do
  container="$(qft_docker compose ps -q "$service")"
  state="$(qft_docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
  printf '%-24s %s\n' "$service" "$state"
  [[ "$state" == "healthy" || "$state" == "running" ]]
done
