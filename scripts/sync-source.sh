#!/usr/bin/env bash
set -euo pipefail

target="${1:-zwj-ubuntu:/opt/quarkfantools}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
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

for module in "${modules[@]}"; do
  rsync -az \
    --exclude='.git/' \
    --exclude='.env' \
    --exclude='.env.*' \
    --exclude='certs/' \
    --exclude='node_modules/' \
    --exclude='dist/' \
    --exclude='dist-server/' \
    --exclude='coverage/' \
    "$root/$module/" "$target/$module/"
done

printf 'Synced %s modules to %s without local secrets.\n' "${#modules[@]}" "$target"
