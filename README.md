# QuarkfanTools Platform Deployment

Production composition for the QuarkfanTools 3.x centers. It builds each service from its sibling Git repository, runs PostgreSQL as the durable system of record, and exposes only the authenticated Console.

## First deployment

```bash
./scripts/generate-env.sh
./scripts/deploy.sh
./scripts/smoke.sh
```

The default Console binding is `127.0.0.1:8080`. Reach a remote host through an encrypted SSH tunnel:

```bash
ssh -L 8080:127.0.0.1:8080 zwj-ubuntu
```

Then open `http://localhost:8080`. For public access, place a real-domain TLS reverse proxy in front and set `BETTER_AUTH_URL`, `TRUSTED_ORIGINS`, `AUTH_SECURE_COOKIES=true`, and `CONSOLE_BIND_ADDRESS=0.0.0.0`.

The bootstrap administrator must change the initial password after first login before management APIs become available.

## Operations

- `docker compose ps`: center status.
- `docker compose logs --since=30m <service>`: service logs.
- `./scripts/backup.sh`: quiesced PostgreSQL and all persistent application volumes backup.
- `./scripts/backup.sh --online`: non-quiesced operational snapshot when a short write pause is unacceptable.
- `./scripts/verify-backup.sh <backup-directory>`: checksum and archive integrity verification.
- `./scripts/restore.sh --from <backup-directory> --confirm`: guarded full restore with a pre-restore backup and final smoke check.
- `./scripts/acceptance.sh`: isolated end-to-end suite against the internal mock service; always restores Browser Worker's production network policy and stops the mock service on exit.
- `./scripts/ui-acceptance.sh`: desktop/mobile Dashboard layout validation with a disposable QA account and no exported server screenshots.
- `docker compose up -d --build <service>`: rolling center update.
- `docker compose down`: stop without deleting durable volumes.

Never use `docker compose down -v` in production unless permanent data deletion was explicitly approved.

Browser Worker blocks localhost, private IP ranges and DNS names resolving to private addresses by default. Enable private networks only for a trusted isolated deployment with an explicit requirement.
