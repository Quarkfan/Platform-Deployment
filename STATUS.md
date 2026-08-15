# Platform Deployment Status

Version `0.1.0` is running on `zwj-ubuntu`. PostgreSQL and ten production services are healthy; only Console binds to host loopback. Source sync excludes secrets, backup/smoke scripts are present, and Compose E2E covers the cross-center execution paths. The acceptance mock model is stopped after tests.
