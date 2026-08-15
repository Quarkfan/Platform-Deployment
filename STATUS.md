# Platform Deployment Status

Version `0.1.0` is running on `zwj-ubuntu`. PostgreSQL and ten production services are healthy; only Console binds to host loopback. Source sync excludes secrets, Compose E2E covers the cross-center execution paths, and the acceptance mock model is stopped after tests.

Operations include a quiesced or online backup of PostgreSQL plus all five persistent application volumes, SHA-256/archive verification, an explicit secret-escrow notice, and a guarded full restore that creates a pre-restore backup before changing data.
