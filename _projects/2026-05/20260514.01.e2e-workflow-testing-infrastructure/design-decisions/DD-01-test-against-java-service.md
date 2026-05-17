# DD-01: Test Against Stigmer Cloud Java Service

**Date**: 2026-05-14
**Status**: Decided
**Decision**: All integration tests must target the Stigmer Cloud Java `stigmer-service`, not the Go `stigmer-server`.

## Context

Stigmer has two implementations of the control plane:
- **Go `stigmer-server`** — OSS local daemon, SQLite, simplified feature set
- **Java `stigmer-service`** — Production service in stigmer-cloud, Postgres, billing, usage tracking, multi-tenancy

## Decision

Test exclusively against the Java service because:
1. It covers billing and usage tracking flows that the Go server doesn't
2. It's what runs in production — regressions there are what matter
3. Testing the Go server gives false confidence about production readiness

## Consequences

- Tests need cross-repo coordination (stigmer + stigmer-cloud)
- Test harness must be able to build/start the Java service
- Requires Postgres (the Java service's native database)
- More complex setup, but far more valuable test coverage
