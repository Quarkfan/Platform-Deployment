#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/docker.sh
qft_select_docker

backup="${1:-}"
if [[ -z "$backup" || ! -d "$backup" ]]; then
  printf 'Usage: %s backups/YYYYMMDDTHHMMSSZ\n' "$0" >&2
  exit 2
fi
backup="$(cd "$backup" && pwd)"

required=(
  MANIFEST.sha256
  metadata.json
  SECRET-ESCROW.txt
  database.dump
  resources.tar.gz
  runtime-workspaces.tar.gz
  browser-sessions.tar.gz
  capability-packages.tar.gz
  capability-workspaces.tar.gz
  deployment-config.tar.gz
)
for file in "${required[@]}"; do
  [[ -f "$backup/$file" ]] || {
    printf 'Backup is missing %s\n' "$file" >&2
    exit 1
  }
done

(
  cd "$backup"
  qft_checksum_verify MANIFEST.sha256
)
qft_docker run --rm --entrypoint pg_restore \
  -v "$backup:/backup:ro" postgres:17-alpine \
  --list /backup/database.dump >/dev/null
for archive in "$backup"/*.tar.gz; do
  tar -tzf "$archive" >/dev/null
done
printf 'Backup verified: %s\n' "$backup"
