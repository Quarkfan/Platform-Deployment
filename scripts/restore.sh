#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/docker.sh
qft_select_docker

backup=""
confirmed=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from)
      backup="${2:-}"
      shift 2
      ;;
    --confirm)
      confirmed=true
      shift
      ;;
    *)
      printf 'Usage: %s --from backups/YYYYMMDDTHHMMSSZ --confirm\n' "$0" >&2
      exit 2
      ;;
  esac
done
if [[ -z "$backup" || "$confirmed" != true ]]; then
  printf 'Restore is destructive. Pass both --from and --confirm.\n' >&2
  exit 2
fi
backup="$(cd "$backup" && pwd)"
scripts/verify-backup.sh "$backup"

printf 'Creating a quiesced pre-restore backup...\n'
scripts/backup.sh

restart_required=false
restart_on_exit() {
  local status=$?
  if [[ "$restart_required" == true ]]; then
    qft_docker compose up -d "${qft_services[@]}" >/dev/null || true
  fi
  return "$status"
}
trap restart_on_exit EXIT
trap 'exit 130' INT TERM

qft_docker compose stop "${qft_services[@]}" >/dev/null
restart_required=true
qft_docker compose exec -T postgres \
  pg_restore -U quarkfan -d quarkfan --clean --if-exists --no-owner --no-privileges \
  < "$backup/database.dump"

volumes=(
  "resources:quarkfantools-resource-data"
  "runtime-workspaces:quarkfantools-runtime-workspaces"
  "browser-sessions:quarkfantools-browser-sessions"
  "capability-packages:quarkfantools-capability-packages"
  "capability-workspaces:quarkfantools-capability-workspaces"
)
for entry in "${volumes[@]}"; do
  name="${entry%%:*}"
  volume="${entry#*:}"
  qft_docker run --rm --entrypoint sh \
    -v "${volume}:/target" \
    -v "$backup:/backup:ro" \
    postgres:17-alpine \
    -eu -c "find /target -mindepth 1 -delete; tar -xzf /backup/${name}.tar.gz -C /target"
done

qft_docker compose up -d --wait "${qft_services[@]}" >/dev/null
restart_required=false
trap - EXIT INT TERM
scripts/smoke.sh
printf 'Restore completed from %s\n' "$backup"
