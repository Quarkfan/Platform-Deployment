#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/docker.sh
qft_select_docker

base_url="${LOOPBACK_AUTH_URL:-http://127.0.0.1:8080}"
[[ "$base_url" =~ ^http://(127\.0\.0\.1|localhost)(:[0-9]+)?$ ]] || {
  printf 'LOOPBACK_AUTH_URL must be an HTTP loopback URL.\n' >&2
  exit 1
}

qa_username="codexqa$(date +%s)${RANDOM}"
qa_password="$(openssl rand -hex 24)"
cookie_jar="$(mktemp)"
response_body="$(mktemp)"
user_created=false

cleanup() {
  local status=$?
  if [[ "$user_created" == true ]]; then
    qft_docker compose exec -T \
      -e QA_USERNAME="$qa_username" \
      -e QA_ACTION=delete \
      -e CONSOLE_AUTH_MODULE=file:///app/dist-server/auth.js \
      console node /app/qft-loopback-qa-user.mjs >/dev/null 2>&1 || status=1
  fi
  qft_docker compose exec -T -u root console rm -f /app/qft-loopback-qa-user.mjs >/dev/null 2>&1 || true
  rm -f "$cookie_jar" "$response_body"
  return "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

console_container="$(qft_docker compose ps -q console)"
[[ -n "$console_container" ]] || {
  printf 'Console must be running.\n' >&2
  exit 1
}

qft_docker cp tests/qa-user.mjs "${console_container}:/app/qft-loopback-qa-user.mjs"
qft_docker compose exec -T \
  -e QA_USERNAME="$qa_username" \
  -e QA_PASSWORD="$qa_password" \
  -e CONSOLE_AUTH_MODULE=file:///app/dist-server/auth.js \
  console node /app/qft-loopback-qa-user.mjs >/dev/null
user_created=true

sign_in_status="$(curl --silent --show-error \
  --output "$response_body" \
  --write-out '%{http_code}' \
  --cookie-jar "$cookie_jar" \
  --header 'content-type: application/json' \
  --data "{\"username\":\"${qa_username}\",\"password\":\"${qa_password}\"}" \
  "${base_url}/api/auth/sign-in/username")"
[[ "$sign_in_status" == 200 ]] || {
  printf 'Loopback sign-in failed with HTTP %s.\n' "$sign_in_status" >&2
  exit 1
}

awk 'NF >= 7 && $4 == "FALSE" { found=1 } END { exit found ? 0 : 1 }' "$cookie_jar" || {
  printf 'Loopback sign-in did not issue a host-local non-Secure cookie.\n' >&2
  exit 1
}

me_status="$(curl --silent --show-error \
  --output "$response_body" \
  --write-out '%{http_code}' \
  --cookie "$cookie_jar" \
  "${base_url}/api/me")"
[[ "$me_status" == 200 ]] || {
  printf 'Loopback session verification failed with HTTP %s.\n' "$me_status" >&2
  exit 1
}

printf 'Loopback authentication smoke passed: sign-in, host-local cookie and /api/me session verified.\n'
