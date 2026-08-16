#!/usr/bin/env bash
set -euo pipefail

mode="${1:-source}"
if [[ "$mode" != "source" && "$mode" != "--deploy" ]]; then
  printf 'Usage: %s [--deploy]\n' "$0" >&2
  exit 2
fi

deployment_dir="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$deployment_dir/.." && pwd)"
modules=(
  Message-Gateway
  Context-Hub
  Model-Hub
  Capability-Registry
  Runtime-Center
  Scheduler-Center
  Resource-Center
  Governance-Center
  Platform-Console
  Platform-Contracts
  Platform-Deployment
)
build_files=(
  Message-Gateway/Dockerfile
  Context-Hub/Dockerfile
  Model-Hub/Dockerfile
  Capability-Registry/Dockerfile
  Capability-Registry/Dockerfile.worker
  Runtime-Center/Dockerfile
  Runtime-Center/Dockerfile.browser
  Scheduler-Center/Dockerfile
  Resource-Center/Dockerfile
  Governance-Center/Dockerfile
  Platform-Console/Dockerfile
)
handoff_files=(
  AGENTS.md
  README.md
  STATUS.md
  docs/3.0-current-release.md
  docs/3.0-completion-audit.md
  docs/extensibility-architecture.md
)

failures=0
require_path() {
  local path="$1"
  if [[ ! -e "$path" ]]; then
    printf 'Missing required release input: %s\n' "$path" >&2
    failures=$((failures + 1))
  fi
}

for module in "${modules[@]}"; do
  if [[ "$module" != "Platform-Deployment" ]]; then
    require_path "$root/$module/package.json"
  fi
  require_path "$root/$module/README.md"
  require_path "$root/$module/STATUS.md"
  require_path "$root/$module/AGENTS.md"
done
for file in "${build_files[@]}"; do
  require_path "$root/$file"
done
for file in "${handoff_files[@]}"; do
  if [[ -e "$root/$file" ]]; then
    continue
  fi
  require_path "$root/_platform-handoff/$file"
done
require_path "$deployment_dir/compose.yaml"
require_path "$deployment_dir/docs/operations.md"
require_path "$deployment_dir/docs/release-handoff.md"
require_path "$deployment_dir/scripts/sync-source.sh"
require_path "$deployment_dir/scripts/smoke.sh"

if (( failures > 0 )); then
  exit 1
fi

if [[ "$mode" == "--deploy" ]]; then
  cd "$deployment_dir"
  test -f .env || {
    printf 'Run scripts/generate-env.sh first.\n' >&2
    exit 1
  }
  . scripts/lib/docker.sh
  qft_select_docker
  qft_docker compose config --quiet
  printf 'Release preflight passed: source, handoff and Compose configuration are complete.\n'
else
  printf 'Source preflight passed: modules, build inputs and handoff documents are complete.\n'
fi
