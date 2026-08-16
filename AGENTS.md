# Platform Deployment Collaboration Guide

This repository owns QuarkfanTools 3.x deployment composition, operational scripts, release manifests, backup/restore procedures, and end-to-end acceptance checks. Product/domain code remains in its owning center repository.

- Keep secrets in an untracked `.env`; never commit credentials, tokens, customer data, private keys, or logs.
- Prefer official images and mature maintained components. Evaluate licenses, security, maintenance, isolation, and upgrade cost before adding infrastructure.
- Dean makes final product and irreversible architecture decisions. Codex must independently identify risks, recommend improvements, and implement low-risk operational fixes.
- Every deployment change must pass `docker compose config`; production changes also require health and smoke checks.
- Local sibling repositories are selected through `QFT_ROOT`. Do not copy center source into this repository.
- Every platform iteration must keep scripts, `README.md`, `STATUS.md`, `docs/operations.md` and `docs/release-handoff.md` current when deployment, rollback or operator behavior changes.
- Child repositories are committed and pushed before the parent gitlinks. Production source sync should come from that clean parent state and must produce `DEPLOYED-SOURCE-MANIFEST.md`.
