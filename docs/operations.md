# Operations Runbook

## Security boundary

Only the deployment edge and the loopback Console endpoint are host-bound. Center APIs and PostgreSQL remain on the private Compose network and require the shared internal service token. Credentials are encrypted by Governance; environment-backed bootstrap credentials are transitional and must not be committed.

The default remote access pattern is an SSH tunnel to `http://127.0.0.1:8080`. The Console selects a host-local non-Secure cookie only for exact loopback hosts and keeps public authentication on Secure cookies backed by the same account database. Public access requires the `https` Compose profile; plaintext public HTTP redirects to HTTPS and must never carry password or session traffic. Do not set `AUTH_SECURE_COOKIES=false` globally as a tunnel workaround.

The initial administrator is marked `must_change_password`. Until the password is changed, only `/api/me` and `/api/account/change-password` are available to that session.

Browser Worker denies private and loopback destinations by default, including DNS results. `BROWSER_ALLOW_PRIVATE_NETWORKS=true` is a deployment-level exception for explicitly trusted installations, not a per-Bot convenience setting.

## Source deployment

Run `scripts/release-preflight.sh` and then `scripts/sync-source.sh [user@host:/absolute/path]` from a clean development checkout. It synchronizes all platform modules while always excluding `.env`, `.env.*`, Git metadata, dependencies, build output, and coverage. It also copies a parent handoff snapshot and writes `DEPLOYED-SOURCE-MANIFEST.md` with exact child commits. Server secrets are server-owned and must never be synchronized from a workstation.

On the server, run `scripts/deploy.sh` from `Platform-Deployment`. The script runs release preflight, validates Compose, builds sequentially for small hosts, starts the stack, and prints service status.

The complete child-first commit order, evidence checklist and rollback handoff are in `docs/release-handoff.md`.

Run `scripts/smoke.sh` for a twelve-service health check. It uses the current user's Docker access when available and otherwise falls back to passwordless `sudo docker`; it fails with an actionable message when neither path is configured.

Run `scripts/extension-smoke.sh` after a plugin/provider release. It queries every center through the authenticated private network, validates generation/install/update metadata, and confirms that all seven center-owned PostgreSQL state tables are readable. It is intentionally read-only; lifecycle recovery tests must use a noncritical Provider, restore its original state, and record the restart evidence in the release handoff.

Run `scripts/acceptance.sh` for the complete cross-center acceptance suite. It temporarily permits Browser Worker to reach the internal mock service and uses an exit trap to restore the production private-network restriction, stop the mock service and rerun smoke checks even when acceptance fails or is interrupted.

Run `scripts/ui-acceptance.sh` to validate all sixteen Dashboard pages at desktop and mobile viewports. It opens every page's “本页指引” dialog, verifies all three guidance sections and closes it with Escape. For configuration pages it enters a create/detail state, including Runtime Profile creation, opens advanced configuration, verifies a unique buttons-only submit footer is the final form row, and checks the return-to-list path. Model, channel and plugin lists also verify that every detectable record has an explicit health state plus a last-check timestamp or never-checked marker. The final layout pass checks overflow and control clipping. The script creates a random disposable QA account, captures only structural layout results, exports no screenshots, and removes the account and temporary files on every exit path.

Set `QA_CAPTURE_SCREENSHOTS=true QA_ARTIFACT_DIR=/absolute/operator/path` only for a temporary visual release review. The selected screenshots and report are copied before cleanup; they may contain operational metadata and must not be committed or retained after the review.

Run `scripts/loopback-auth-smoke.sh` after Console authentication or HTTPS configuration changes. It creates a guarded disposable account, signs in through the host loopback endpoint, verifies that the cookie is host-local and non-Secure, confirms `/api/me` accepts the session, and removes the account and temporary files on every exit path. The browser login performs the same session check before reloading and leaves an actionable error on screen if the cookie was rejected.

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

If loopback SNI succeeds but several external probes report a reset, capture only inbound TLS while an external probe runs:

```bash
sudo tcpdump -nn -i any 'dst host <public-ip> and dst port 443'
```

When no probe packet reaches the host, do not weaken TLS, secure cookies or host firewall rules. Check the cloud firewall and, for mainland China hosts, the domain's ICP filing/access-provider status. The supported resolutions are clearing the provider gate, completing filing, or placing the service behind an approved public edge. Plaintext authentication and unusual-port bypasses are not production fixes.

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
