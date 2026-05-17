# Remove Legacy E2E Test Suite

**Date**: May 14, 2026

## Summary

Deleted the stale `test/e2e/` module — 140 files, ~23,000 lines of code — and removed it from the Go workspace. This legacy suite required a manually pre-started server, Temporal, and Ollama, provided no execution confidence, and created a false sense of coverage. It has been fully replaced by the new `test/integration/` infrastructure.

## Problem Statement

The legacy E2E test suite in `test/e2e/` was built for the OSS Go `stigmer-server` and tested only the deployment phase (agent/workflow `apply`). It had fundamental design flaws that made it unsuitable as the integration testing foundation for the platform.

### Pain Points

- **Manual infrastructure dependency**: Tests required a pre-running Stigmer server, Temporal, and Ollama — no isolation, no reproducibility
- **Wrong target**: Tested the OSS Go server, not the production Java service (`stigmer-service`) that handles billing, usage tracking, and multi-tenancy
- **No execution coverage**: Tested resource `apply` operations but never validated the actual workflow execution pipeline (Temporal dispatching, workflow-runner, zigflow engine, gRPC callbacks)
- **Flaky and unmaintained**: Extensive documentation about flakiness fixes and refactoring attempts indicated ongoing instability
- **False confidence**: 15 passing tests that didn't cover the production execution path gave a misleading picture of system health

## Solution

Removed the entire `test/e2e/` module from the repository. The new `test/integration/` infrastructure (built in prior sessions) is the replacement — it validates the full production pipeline end-to-end with proper isolation via Testcontainers.

## Implementation Details

- Deleted `test/e2e/` directory tree (140 files: 92 Go source, docs, testdata, tools, Cursor agent rules)
- Removed `./test/e2e` from `go.work`
- Ran `go work sync` + `go mod tidy` to clean up workspace dependency manifests
- Verified all 10 remaining workspace modules build cleanly

## Benefits

- **~23,000 lines of dead code removed** — reduces codebase noise, speeds up IDE indexing, eliminates stale Cursor agent rules
- **No more confusion** about which test suite is authoritative — `test/integration/` is the single source of truth
- **Cleaner workspace** — `go work sync` no longer needs to resolve dependencies for the deleted module's transitive graph (Temporal, CLI, Ollama SDK, etc.)
- **Unblocks CI wiring** — T06 can wire `test/integration/` into GitHub Actions without worrying about legacy test conflicts

## Impact

- **Build system**: `go.work` is cleaner; no Makefile or CI changes needed (the legacy suite was never wired into either)
- **Developer experience**: One less module to think about; `test/integration/` is the clear path for adding new integration tests
- **Historical artifacts preserved**: `_changelog/` and `_projects/` references to `test/e2e/` left intact as historical record; git history retains all deleted code

## Related Work

- Part of the [E2E Workflow Testing Infrastructure](../_projects/2026-05/20260514.01.e2e-workflow-testing-infrastructure/) project
- Predecessor sessions built the replacement `test/integration/` harness (T01, T03, T05 completed)
- Next: T04 (JUnit XML output) and T06 (CI workflow)

---

**Status**: Production Ready
**Timeline**: ~10 minutes (clean deletion after thorough impact analysis)
