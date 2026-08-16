#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  cat >&2 <<'EOF'
Usage: scripts/configure-https.sh --domain <hostname> --certificate <fullchain.pem> --private-key <privkey.pem>

Validates and installs an operator-supplied TLS certificate, then updates .env
for the Compose HTTPS profile. The command does not start or restart services.
EOF
  exit 2
}

domain=""
certificate=""
private_key=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) domain="${2:-}"; shift 2 ;;
    --certificate) certificate="${2:-}"; shift 2 ;;
    --private-key) private_key="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -n "$domain" && -n "$certificate" && -n "$private_key" ]] || usage
[[ "$domain" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "Invalid TLS domain" >&2; exit 1; }
[[ -f .env ]] || { echo "Run scripts/generate-env.sh first" >&2; exit 1; }
[[ -r "$certificate" ]] || { echo "Certificate is not readable: $certificate" >&2; exit 1; }
[[ -r "$private_key" ]] || { echo "Private key is not readable: $private_key" >&2; exit 1; }

openssl x509 -in "$certificate" -noout >/dev/null
openssl pkey -in "$private_key" -noout >/dev/null 2>&1
subject_alt_names="$(openssl x509 -in "$certificate" -noout -text | sed -n '/Subject Alternative Name/,+1p' | tail -1 | tr ',' '\n' | sed 's/^[[:space:]]*//')"
printf '%s\n' "$subject_alt_names" | grep -Fqx "DNS:$domain" || {
  echo "Certificate does not contain DNS:$domain in Subject Alternative Name" >&2
  exit 1
}
openssl x509 -in "$certificate" -checkend 604800 -noout >/dev/null || {
  echo "Certificate expires in less than seven days" >&2
  exit 1
}

certificate_key_hash="$(openssl x509 -in "$certificate" -pubkey -noout | openssl pkey -pubin -outform DER 2>/dev/null | openssl dgst -sha256)"
private_key_hash="$(openssl pkey -in "$private_key" -pubout -outform DER 2>/dev/null | openssl dgst -sha256)"
[[ "$certificate_key_hash" == "$private_key_hash" ]] || {
  echo "Certificate and private key do not match" >&2
  exit 1
}

certificate_blocks="$(grep -c '^-----BEGIN CERTIFICATE-----$' "$certificate")"
[[ "$certificate_blocks" -ge 2 ]] || {
  echo "Certificate file must contain the leaf and intermediate certificate chain" >&2
  exit 1
}

upsert_env() {
  local key="$1"
  local value="$2"
  local temporary
  temporary="$(mktemp .env.https.XXXXXX)"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' .env > "$temporary"
  chmod 600 "$temporary"
  mv "$temporary" .env
}

umask 077
backup=".env.before-https-$(date -u +%Y%m%dT%H%M%SZ)"
cp .env "$backup"
chmod 600 "$backup"
mkdir -p certs
chmod 700 certs
install -m 600 "$certificate" certs/fullchain.pem
install -m 600 "$private_key" certs/privkey.pem

upsert_env COMPOSE_PROFILES https
upsert_env TLS_DOMAIN "$domain"
upsert_env TLS_CERTIFICATE_PATH ./certs/fullchain.pem
upsert_env TLS_PRIVATE_KEY_PATH ./certs/privkey.pem
upsert_env EDGE_BIND_ADDRESS 0.0.0.0
upsert_env EDGE_HTTP_PORT 80
upsert_env EDGE_HTTPS_PORT 443
upsert_env EDGE_UID "$(id -u)"
upsert_env EDGE_GID "$(id -g)"
upsert_env CONSOLE_BIND_ADDRESS 127.0.0.1
upsert_env CONSOLE_PORT 8080
upsert_env BETTER_AUTH_URL "https://$domain"
upsert_env LARK_OAUTH_REDIRECT_BASE_URL "https://$domain"
upsert_env TRUSTED_ORIGINS "https://$domain"
upsert_env AUTH_SECURE_COOKIES true

echo "Installed TLS material for $domain. Previous environment: $backup"
echo "Run scripts/deploy.sh, then scripts/smoke.sh."
