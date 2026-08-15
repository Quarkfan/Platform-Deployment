#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/docker.sh
qft_select_docker

qa_username="codexqa$(date +%s)${RANDOM}"
qa_password="$(openssl rand -hex 24)"
user_created=false

cleanup() {
  local status=$?
  if [[ "$user_created" == true ]]; then
    qft_docker compose exec -T \
      -e QA_USERNAME="$qa_username" \
      -e QA_ACTION=delete \
      -e CONSOLE_AUTH_MODULE=file:///app/dist-server/auth.js \
      console node /app/qft-qa-user.mjs >/dev/null 2>&1 || status=1
  fi
  qft_docker compose exec -T -u root console rm -f /app/qft-qa-user.mjs >/dev/null 2>&1 || true
  qft_docker compose exec -T browser-worker rm -rf /tmp/qft-ui.mjs /tmp/qft-ui-qa >/dev/null 2>&1 || true
  return "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

console_container="$(qft_docker compose ps -q console)"
browser_container="$(qft_docker compose ps -q browser-worker)"
[[ -n "$console_container" && -n "$browser_container" ]] || {
  printf 'Console and Browser Worker must be running.\n' >&2
  exit 1
}
qft_docker cp tests/qa-user.mjs "${console_container}:/app/qft-qa-user.mjs"
qft_docker cp tests/ui.mjs "${browser_container}:/tmp/qft-ui.mjs"

qft_docker compose exec -T \
  -e QA_USERNAME="$qa_username" \
  -e QA_PASSWORD="$qa_password" \
  -e CONSOLE_AUTH_MODULE=file:///app/dist-server/auth.js \
  console node /app/qft-qa-user.mjs >/dev/null
user_created=true

qft_docker compose exec -T \
  -e QA_USERNAME="$qa_username" \
  -e QA_PASSWORD="$qa_password" \
  -e QA_BASE_URL=http://console:8080 \
  -e QA_OUTPUT=/tmp/qft-ui-qa \
  -e QA_CAPTURE_SCREENSHOTS=false \
  -e QA_PLAYWRIGHT_BASE=/app \
  browser-worker node /tmp/qft-ui.mjs
