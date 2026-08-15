#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
services=(message-gateway context-hub model-hub capability-registry runtime-center scheduler-center resource-center governance-center browser-worker console)
for service in "${services[@]}"; do
  container="$(docker compose ps -q "$service")"
  state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
  printf '%-24s %s\n' "$service" "$state"
  [[ "$state" == "healthy" || "$state" == "running" ]]
done
