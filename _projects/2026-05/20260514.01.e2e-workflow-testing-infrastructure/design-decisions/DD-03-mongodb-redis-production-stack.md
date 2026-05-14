# DD-03: MongoDB + Redis (Production Stack), Not SQLite

**Date**: 2026-05-14
**Status**: Decided
**Decision**: Use Testcontainers for MongoDB and Redis — the actual production data stack of the Java `stigmer-service`.

## Context

The research report recommended Postgres based on the Go `stigmer-server` assumptions. However, the actual Stigmer Cloud Java service (`stigmer-service`) uses:
- **MongoDB** as primary datastore (Spring Data MongoDB, Mongock migrations)
- **Redis** for cache and sessions

The Go `stigmer-server` uses SQLite — but per DD-01, we're testing against the Java service.

## Decision

Use the production-identical stack:
- **MongoDB** container via Testcontainers-Go (`testcontainers/testcontainers-go/modules/mongodb`)
- **Redis** container via Testcontainers-Go (`testcontainers/testcontainers-go/modules/redis`)

Each test suite gets fresh containers. No shared state across suites.

## Consequences

- Tests match production exactly — no false positives from different DB behavior
- Testcontainers handles Docker lifecycle (start, health check, cleanup)
- Requires Docker available both locally and in CI (standard)
- MongoDB + Redis adds ~5-10 seconds of container startup (acceptable for suite scope)
- The Java service connects using standard `MONGO_DB_*` and `REDIS_*` env vars
