#!/usr/bin/env bash
set -euo pipefail

target="${1:-zwj-ubuntu:/opt/quarkfantools}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
manifest="$temporary/DEPLOYED-SOURCE-MANIFEST.md"
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

if [[ "${SYNC_ALLOW_DIRTY:-false}" != "true" ]]; then
  for module in "${modules[@]}"; do
    if [[ -n "$(git -C "$root/$module" status --porcelain --untracked-files=no)" ]]; then
      printf '%s has tracked changes. Commit them first or set SYNC_ALLOW_DIRTY=true for an explicit non-release sync.\n' "$module" >&2
      exit 1
    fi
    expected="$(git -C "$root" ls-tree --format='%(objectname)' HEAD "$module" 2>/dev/null || true)"
    actual="$(git -C "$root/$module" rev-parse HEAD)"
    if [[ -n "$expected" && "$expected" != "$actual" ]]; then
      printf '%s is at %s but parent HEAD records %s. Commit the parent gitlink before release sync.\n' "$module" "$actual" "$expected" >&2
      exit 1
    fi
  done
fi

parent_commit="$(git -C "$root" rev-parse HEAD 2>/dev/null || printf 'unavailable')"
{
  printf '# Deployed Source Manifest\n\n'
  printf -- '- Generated (UTC): `%s`\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf -- '- Parent: `%s`\n\n' "$parent_commit"
  printf '| Module | Commit |\n| --- | --- |\n'
  for module in "${modules[@]}"; do
    printf '| `%s` | `%s` |\n' "$module" "$(git -C "$root/$module" rev-parse HEAD 2>/dev/null || printf 'unavailable')"
  done
} >"$manifest"

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

rsync -az "$root/AGENTS.md" "$root/README.md" "$root/STATUS.md" "$target/_platform-handoff/"
rsync -az "$root/docs/" "$target/_platform-handoff/docs/"
rsync -az "$manifest" "$target/DEPLOYED-SOURCE-MANIFEST.md"

printf 'Synced %s modules, parent handoff documents and an exact source manifest to %s without local secrets.\n' "${#modules[@]}" "$target"
