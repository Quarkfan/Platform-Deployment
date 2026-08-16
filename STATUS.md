# Platform Deployment Status

Version `0.1.0` is running on `zwj-ubuntu`. PostgreSQL and eleven application services are healthy. Public deployments use the optional Caddy HTTPS edge while Console remains bound to host loopback; local deployments retain the SSH-tunnel default. Source sync excludes secrets, Compose E2E covers the cross-center execution paths, and the acceptance mock model is stopped after tests.

The production Dashboard is available at `https://tool.quarkfan.com`. HTTP port 80 redirects to the canonical HTTPS domain, secure cookies and HSTS are enabled, and the installed DigiCert certificate is valid through 2026-11-13. Renewal remains an operator responsibility.

Operations include a quiesced or online backup of PostgreSQL plus all five persistent application volumes, SHA-256/archive verification, an explicit secret-escrow notice, and a guarded full restore that creates a pre-restore backup before changing data.

The Dashboard exposes searchable **使用手册** from the lower-left auxiliary navigation. Configuration CRUD and advanced-setting controls were deployed on 2026-08-16 after a verified online backup. Unit/type/build checks, HTTPS smoke, complete Compose E2E, and desktop/mobile UI acceptance all pass. Acceptance runs clean their tenant-scoped database, resource, workspace, capability-package and attributable browser-session artifacts on exit. The cleanup command defaults to preview mode and does not delete records that cannot be proven to belong to acceptance.
