# Release And Handoff Gate

Every platform iteration leaves a reproducible parent commit, deployable source tree and current operator handoff. A feature is not complete when code passes locally but deployment or rollback instructions describe an older system.

## Required update matrix

| Change                           | Owning repository                               | Parent                              | Deployment repository                    |
| -------------------------------- | ----------------------------------------------- | ----------------------------------- | ---------------------------------------- |
| Domain behavior or contract      | README/STATUS/design/API/tests                  | STATUS, release/audit docs, gitlink | Compose/env/smoke/E2E when affected      |
| Provider/plugin/runtime change   | provider docs, compatibility and contract tests | extensibility/release docs, gitlink | image, rollout, rollback and diagnostics |
| Dashboard change                 | Console README/STATUS/manual/UI tests           | release/audit docs, gitlink         | UI acceptance (including hover-only health details) and operator guide |
| Deployment-only change           | N/A                                             | STATUS and gitlink                  | scripts, operations, status and tests    |
| Documentation-only clarification | owning docs/STATUS                              | relevant index/status               | only when operator behavior changes      |

## Release order

1. Update code, tests, module README/STATUS and module-specific handoff docs.
2. Run module tests, typecheck/build and focused acceptance.
3. Commit and push every changed child repository.
4. Update parent design/release/audit documents and child gitlinks.
5. Commit and push the parent repository.
6. Run `Platform-Deployment/scripts/release-preflight.sh`.
7. Create a verified backup before any production data or configuration change.
8. Run `scripts/sync-source.sh`; it refuses tracked dirty modules unless `SYNC_ALLOW_DIRTY=true` is explicitly set, copies the parent handoff snapshot, and writes `DEPLOYED-SOURCE-MANIFEST.md` with exact commits.
9. On the server run `scripts/deploy.sh`, `scripts/smoke.sh`, the focused acceptance suites and full acceptance required by blast radius.
10. Update deployed evidence in module and parent STATUS/release docs, then commit child repositories first and the parent pointer last if evidence changed.

For extension releases, run `scripts/extension-smoke.sh`, verify `/v1/runtime-providers`, `/v1/runtime-profiles` and every center's `/v1/extensions` surface before UI acceptance. Runtime schema migration is additive (`rt.runtime_providers`, `rt.runtime_profiles`, `rt.session_events`). Center-local extension migration is also additive (`extension_states` and `extension_events` in `mg`, `ch`, `mh`, `cr`, `sched`, `res` and `gov`). Rollback keeps these additive tables; older images ignore them.

## Rollback information

Every release handoff records:

- parent commit and exact child commits;
- database/schema compatibility and backup path;
- changed images/services and required environment variables;
- forward deployment commands;
- rollback commit/image and whether schema rollback is supported;
- health, smoke, E2E and UI evidence;
- known degradations and external dependencies.

The parent gitlinks are the release manifest of source. The server-side `DEPLOYED-SOURCE-MANIFEST.md` is deployment evidence, not a replacement for Git history.

## Documentation gate

Before reporting a platform iteration complete, confirm:

- a new session can enter through parent `AGENTS.md`, `STATUS.md` and `docs/README.md`;
- each changed child has current `AGENTS.md`, `README.md`, `STATUS.md` and authoritative design links;
- `docs/3.0-current-release.md` distinguishes deployed behavior from design/incubation work;
- `docs/3.0-completion-audit.md` contains no stale blockers or false completion claims;
- operations, backup, restore, smoke and rollback commands still match scripts;
- no credentials, private keys, customer data or unredacted logs are present.
