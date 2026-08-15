# Operations Runbook

## Security boundary

Only the Console is host-bound. Center APIs and PostgreSQL remain on the private Compose network and require the shared internal service token. Credentials are encrypted by Governance; environment-backed bootstrap credentials are transitional and must not be committed.

The default remote access pattern is an SSH tunnel. Public HTTP is intentionally unsupported because it would expose password and session traffic without transport encryption.

The initial administrator is marked `must_change_password`. Until the password is changed, only `/api/me` and `/api/account/change-password` are available to that session.

Browser Worker denies private and loopback destinations by default, including DNS results. `BROWSER_ALLOW_PRIVATE_NETWORKS=true` is a deployment-level exception for explicitly trusted installations, not a per-Bot convenience setting.

## Source deployment

Run `scripts/sync-source.sh [user@host:/absolute/path]` from a development checkout. It synchronizes all platform modules while always excluding `.env`, `.env.*`, Git metadata, dependencies, build output, and coverage. Server secrets are server-owned and must never be synchronized from a workstation.

On the server, run `scripts/deploy.sh` from `Platform-Deployment`. The script validates Compose, builds sequentially for small hosts, starts the stack, and prints service status.

Run `scripts/smoke.sh` for a ten-service health check. It uses the current user's Docker access when available and otherwise falls back to passwordless `sudo docker`; it fails with an actionable message when neither path is configured.

## Recovery

1. Stop write traffic with `docker compose stop console message-gateway scheduler-center`.
2. Restore PostgreSQL with `pg_restore --clean --if-exists` inside the database container.
3. Restore the `resource-data`, `runtime-workspaces`, and `browser-sessions` volumes as required.
4. Start centers, run `scripts/smoke.sh`, then restore ingress services.

## Capacity

The initial target is a small single-node installation. Builds are sequential (`COMPOSE_PARALLEL_LIMIT=1`), Scheduler concurrency defaults to 2, media concurrency to 1, and Chromium shared memory to 512 MiB. Move PostgreSQL and workers to separate hosts before increasing concurrency on memory-constrained servers.
