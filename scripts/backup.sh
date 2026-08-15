#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="backups/${stamp}"
mkdir -p "$target"
docker compose exec -T postgres pg_dump -U quarkfan -d quarkfan -Fc > "${target}/database.dump"
docker run --rm -v quarkfantools-resource-data:/source:ro -v "$PWD/${target}:/backup" alpine tar -czf /backup/resources.tar.gz -C /source .
tar -czf "${target}/deployment-config.tar.gz" compose.yaml .env.example docs README.md
echo "Backup written to ${target}"
