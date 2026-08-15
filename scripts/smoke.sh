#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

docker_cmd=(docker)
if ! docker info >/dev/null 2>&1; then
  if sudo -n docker info >/dev/null 2>&1; then
    docker_cmd=(sudo -n docker)
  else
    printf 'Docker is unavailable. Grant the current user Docker access or configure passwordless sudo for Docker.\n' >&2
    exit 1
  fi
fi

services=(message-gateway context-hub model-hub capability-registry runtime-center scheduler-center resource-center governance-center browser-worker console)
for service in "${services[@]}"; do
  container="$("${docker_cmd[@]}" compose ps -q "$service")"
  state="$("${docker_cmd[@]}" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
  printf '%-24s %s\n' "$service" "$state"
  [[ "$state" == "healthy" || "$state" == "running" ]]
done
