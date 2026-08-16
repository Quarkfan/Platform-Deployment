# Operations Runbook

## Security boundary

Only the deployment edge and the loopback Console endpoint are host-bound. Center APIs and PostgreSQL remain on the private Compose network and require the shared internal service token. Credentials are encrypted by Governance; environment-backed bootstrap credentials are transitional and must not be committed.

The default remote access pattern is an SSH tunnel. Public access requires the `https` Compose profile; plaintext HTTP redirects to HTTPS and must never carry password or session traffic.

The initial administrator is marked `must_change_password`. Until the password is changed, only `/api/me` and `/api/account/change-password` are available to that session.

Browser Worker denies private and loopback destinations by default, including DNS results. `BROWSER_ALLOW_PRIVATE_NETWORKS=true` is a deployment-level exception for explicitly trusted installations, not a per-Bot convenience setting.

## Source deployment

Run `scripts/sync-source.sh [user@host:/absolute/path]` from a development checkout. It synchronizes all platform modules while always excluding `.env`, `.env.*`, Git metadata, dependencies, build output, and coverage. Server secrets are server-owned and must never be synchronized from a workstation.

On the server, run `scripts/deploy.sh` from `Platform-Deployment`. The script validates Compose, builds sequentially for small hosts, starts the stack, and prints service status.

Run `scripts/smoke.sh` for an eleven-service health check. It uses the current user's Docker access when available and otherwise falls back to passwordless `sudo docker`; it fails with an actionable message when neither path is configured.

Run `scripts/acceptance.sh` for the complete cross-center acceptance suite. It temporarily permits Browser Worker to reach the internal mock service and uses an exit trap to restore the production private-network restriction, stop the mock service and rerun smoke checks even when acceptance fails or is interrupted.

Run `scripts/ui-acceptance.sh` to validate all fourteen Dashboard pages at desktop and mobile viewports. The script creates a random disposable QA account, captures only structural layout results, exports no screenshots, and removes the account and temporary files on every exit path.

## Public HTTPS

Before enabling public access, point the domain's A record at the host and obtain a PEM certificate file containing the leaf certificate followed by its intermediate chain, plus the matching unencrypted PEM private key. Install them with:

```bash
./scripts/configure-https.sh \
  --domain tool.example.com \
  --certificate /secure/path/fullchain.pem \
  --private-key /secure/path/privkey.pem
sudo -n docker compose stop console
./scripts/deploy.sh
./scripts/smoke.sh
```

Stopping Console before the first transition releases a previously public port 80 mapping. Subsequent deployments do not require that step. The configuration script checks the certificate syntax, exact Subject Alternative Name, seven-day minimum remaining validity, full-chain presence, and public-key match before changing `.env`. It keeps the previous environment as an ignored mode-`0600` `.env.before-https-*` file. The edge container runs as the installing operator's UID/GID so its non-root process can read the mode-`0600` private key without granting broader filesystem capabilities.

Verify the public boundary after every certificate change:

```bash
curl -I http://tool.example.com/
curl --fail --show-error https://tool.example.com/healthz
openssl s_client -connect tool.example.com:443 -servername tool.example.com -verify_return_error </dev/null
```

Renew and reinstall the certificate before its `notAfter` date, then recreate only the edge service with `docker compose up -d --force-recreate edge`. Certificate files and private keys are not included in application backups; retain them in the operator-controlled secret escrow.

## Recovery

Create the default quiesced backup before upgrades or configuration changes:

```bash
./scripts/backup.sh
```

This pauses application writers, dumps PostgreSQL, archives all five persistent application volumes, creates a SHA-256 manifest, verifies the result, and restarts the stack. Use `./scripts/backup.sh --online` only when a short pause is unacceptable; its database and volume snapshots are individually readable but are not guaranteed to represent one cross-service instant.

Backups intentionally exclude `.env` and live credentials. Store the deployment secret material separately in an encrypted operator-controlled escrow. The generated `SECRET-ESCROW.txt` records this requirement without containing the secrets.

Verify a transferred or retained backup before relying on it:

```bash
./scripts/verify-backup.sh /absolute/path/to/backup
```

Restore requires an explicit confirmation flag:

```bash
./scripts/restore.sh --from /absolute/path/to/backup --confirm
```

The restore script verifies the backup, creates a quiesced pre-restore backup, stops application services, restores PostgreSQL and every persistent volume, starts the platform, and runs the eleven-service smoke check. Test restore procedures on an isolated host or clone of production; do not use the live installation as a rehearsal target.

## Capacity

The initial target is a small single-node installation. Builds are sequential (`COMPOSE_PARALLEL_LIMIT=1`), Scheduler concurrency defaults to 2, media concurrency to 1, and Chromium shared memory to 512 MiB. Move PostgreSQL and workers to separate hosts before increasing concurrency on memory-constrained servers.
