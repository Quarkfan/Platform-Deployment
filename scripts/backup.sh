#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/docker.sh
qft_select_docker

mode="quiesced"
if [[ "${1:-}" == "--online" ]]; then
  mode="online"
elif [[ $# -gt 0 ]]; then
  printf 'Usage: %s [--online]\n' "$0" >&2
  exit 2
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
target="backups/${stamp}"
staging="backups/.${stamp}.partial"
absolute_staging="$PWD/$staging"
applications_stopped=false

restart_applications() {
  if [[ "$applications_stopped" == true ]]; then
    qft_docker compose up -d "${qft_services[@]}" >/dev/null
  fi
}

cleanup() {
  local status=$?
  restart_applications
  if [[ $status -ne 0 ]]; then
    rm -rf "$staging"
  fi
  return "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

umask 077
mkdir -p backups
[[ ! -e "$target" && ! -e "$staging" ]] || {
  printf 'Backup target already exists: %s\n' "$target" >&2
  exit 1
}
mkdir "$staging"

if [[ "$mode" == "quiesced" ]]; then
  qft_docker compose stop "${qft_services[@]}" >/dev/null
  applications_stopped=true
fi

qft_docker compose exec -T postgres \
  pg_dump -U quarkfan -d quarkfan -Fc > "$staging/database.dump"

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
  qft_docker run --rm --entrypoint tar \
    -v "${volume}:/source:ro" \
    -v "${absolute_staging}:/backup" \
    postgres:17-alpine \
    -czf "/backup/${name}.tar.gz" -C /source .
done
qft_docker run --rm --entrypoint sh \
  -v "${absolute_staging}:/backup" postgres:17-alpine \
  -eu -c "chown $(id -u):$(id -g) /backup/*.tar.gz; chmod 600 /backup/*.tar.gz"

tar -czf "$staging/deployment-config.tar.gz" \
  compose.yaml .env.example README.md docs scripts
cat > "$staging/SECRET-ESCROW.txt" <<'EOF'
This backup intentionally excludes .env and all plaintext secrets.
Recovery also requires the matching POSTGRES_PASSWORD, INTERNAL_SERVICE_TOKEN,
CREDENTIAL_MASTER_KEY_BASE64 and BETTER_AUTH_SECRET from an independent secret escrow.
Without the original credential master key, encrypted provider and browser state cannot be recovered.
EOF
printf '{"formatVersion":1,"createdAt":"%s","mode":"%s","database":"postgresql","volumes":5}\n' \
  "$created_at" "$mode" > "$staging/metadata.json"
(
  cd "$staging"
  qft_checksum_create \
    database.dump \
    resources.tar.gz \
    runtime-workspaces.tar.gz \
    browser-sessions.tar.gz \
    capability-packages.tar.gz \
    capability-workspaces.tar.gz \
    deployment-config.tar.gz \
    SECRET-ESCROW.txt \
    metadata.json > MANIFEST.sha256
)

scripts/verify-backup.sh "$staging"

mv "$staging" "$target"
restart_applications
applications_stopped=false
trap - EXIT INT TERM
printf 'Backup written to %s (%s). Store the matching secrets separately.\n' "$target" "$mode"
