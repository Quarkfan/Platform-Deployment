# QuarkfanTools Platform Deployment

Production composition for the QuarkfanTools 3.x centers. It builds each service from its sibling Git repository, runs PostgreSQL as the durable system of record, and exposes only the authenticated Console.

## First deployment

```bash
./scripts/generate-env.sh
./scripts/release-preflight.sh --deploy
./scripts/deploy.sh
./scripts/smoke.sh
```

The default Console binding is `127.0.0.1:8080`. Reach a remote host through an encrypted SSH tunnel:

```bash
ssh -L 8080:127.0.0.1:8080 zwj-ubuntu
```

Then open `http://127.0.0.1:8080` (or `http://localhost:8080`). The Console uses a host-local non-Secure cookie only for exact loopback hosts so an SSH tunnel can retain a session. Public hosts continue to require HTTPS and Secure cookies; never disable secure cookies globally to make a tunnel work.

For public access, install a complete PEM chain and its matching unencrypted PEM private key:

```bash
./scripts/configure-https.sh \
  --domain tool.example.com \
  --certificate /secure/path/fullchain.pem \
  --private-key /secure/path/privkey.pem
./scripts/deploy.sh
./scripts/smoke.sh
```

The HTTPS profile runs Caddy on public ports 80 and 443, redirects HTTP to HTTPS, sets transport security headers, enables secure authentication cookies, and keeps Console itself on host loopback. TLS material is installed mode `0600` under the ignored `certs/` directory and is never source-synchronized or committed.

The bootstrap administrator must change the initial password after first login before management APIs become available.

After login, open **使用手册** in the main navigation. It contains searchable first-run, routine-operation, troubleshooting, security and maintenance guides with direct links to the relevant control page.

## Operations

- `docker compose ps`: center status.
- `docker compose logs --since=30m <service>`: service logs.
- `./scripts/backup.sh`: quiesced PostgreSQL and all persistent application volumes backup.
- `./scripts/backup.sh --online`: non-quiesced operational snapshot when a short write pause is unacceptable.
- `./scripts/verify-backup.sh <backup-directory>`: checksum and archive integrity verification.
- `./scripts/extension-smoke.sh`: verify all seven extension inventories, durable metadata fields and PostgreSQL state tables without changing lifecycle state.
- `./scripts/loopback-auth-smoke.sh`: create a disposable account and verify loopback sign-in, host-local cookie persistence and `/api/me`, then remove all temporary state.
- `./scripts/restore.sh --from <backup-directory> --confirm`: guarded full restore with a pre-restore backup and final smoke check.
- `./scripts/acceptance.sh`: isolated end-to-end suite against the internal mock service; always restores Browser Worker's production network policy, stops the mock service and removes data that is explicitly scoped to the acceptance tenant on exit.
- `./scripts/cleanup-acceptance.sh`: preview acceptance-data cleanup; add `--apply` only after a verified backup. Unattributed records are deliberately retained.
- `./scripts/ui-acceptance.sh`: desktop/mobile Dashboard layout validation through the configured public Console URL with a disposable QA account and no exported server screenshots.
- `./scripts/release-preflight.sh [--deploy]`: verify module source, Docker build inputs, handoff documents and optionally live Compose configuration before release.
- `./scripts/sync-source.sh`: synchronize clean module source plus the parent handoff snapshot and exact commit manifest; set `SYNC_ALLOW_DIRTY=true` only for an explicitly non-release diagnostic sync.
- `docker compose up -d --build <service>`: rolling center update.
- `docker compose down`: stop without deleting durable volumes.
- `./scripts/configure-https.sh ...`: validate and install an operator-supplied certificate, save a mode-`0600` environment backup, and enable the `https` Compose profile.

Never use `docker compose down -v` in production unless permanent data deletion was explicitly approved.

Browser Worker blocks localhost, private IP ranges and DNS names resolving to private addresses by default. Enable private networks only for a trusted isolated deployment with an explicit requirement.

The complete release order, documentation gate and rollback handoff are in `docs/release-handoff.md`.
