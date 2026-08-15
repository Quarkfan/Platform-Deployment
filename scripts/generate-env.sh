#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -e .env ]]; then
  echo ".env already exists; refusing to overwrite it" >&2
  exit 1
fi
token="$(openssl rand -hex 32)"
postgres_password="$(openssl rand -hex 24)"
credential_key="$(openssl rand -base64 32)"
auth_secret="$(openssl rand -hex 32)"
admin_password="$(openssl rand -base64 24 | tr -d '\n' | tr '/+' '_-')"
umask 077
sed \
  -e "s|generate-a-long-url-safe-value|${postgres_password}|" \
  -e "s|generate-internal-service-token|${token}|" \
  -e "s|generate-exactly-32-random-bytes-as-base64|${credential_key}|" \
  -e "s|generate-better-auth-secret|${auth_secret}|" \
  -e "s|generate-initial-admin-password|${admin_password}|" \
  .env.example > .env
chmod 600 .env
printf 'Created %s/.env\nInitial admin username: admin\nInitial admin password: %s\n' "$PWD" "$admin_password"
