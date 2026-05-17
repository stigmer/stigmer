# DD-04: Tests Must Work Locally AND in CI

**Date**: 2026-05-14
**Status**: Decided
**Decision**: Every integration test must be runnable both locally and in CI.

## Context

The previous E2E test setup was local-only and produced "very bad results" — tests rotted because they didn't run in CI, and the manual setup burden meant developers rarely ran them.

## Decision

Hard requirement: `make test-integration` must work identically on a developer machine and in GitHub Actions. No test should require CI-only infrastructure. No test should require a pre-existing running server.

## Consequences

- Test harness must manage its own infrastructure (Testcontainers, Temporal dev server, service processes)
- No dependency on pre-running services or specific filesystem paths
- Docker must be available both locally and in CI (standard for both)
- Slightly more complex harness, but dramatically better test reliability and adoption
