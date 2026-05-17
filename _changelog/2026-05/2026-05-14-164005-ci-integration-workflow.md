# CI Integration Workflow (Offline)

**Date**: May 14, 2026

## Summary

Created a GitHub Actions CI workflow that runs the end-to-end integration test suite on PRs and pushes to main. The workflow builds the stigmer-cloud Java service fat JAR from source, then runs `make test-integration` with full infrastructure (Testcontainers, Temporal, workflow-runner), producing JUnit XML reports with per-test annotations directly on PRs.

## Problem Statement

The integration test suite (T01–T04) validates the full workflow execution pipeline end-to-end — Go test harness, Testcontainers, Temporal, Java service, workflow-runner, zigflow engine, gRPC callbacks — but only ran locally. There was no CI workflow to prevent regressions on PRs or catch drift between the two repositories.

### Pain Points

- Integration tests required manual local execution — no automated regression detection
- Cross-repo dependency (stigmer-cloud fat JAR) had no established CI consumption pattern
- Test failures produced no structured reporting (JUnit XML existed locally but was never published)
- The test harness silently exits 0 when the JAR is missing — a CI-invisible skip

## Solution

A two-job GitHub Actions workflow with a clean separation between artifact production and test execution:

- **Job 1 (Build Service JAR)**: Checks out `stigmer-cloud` (private repo), builds the fat JAR with Bazel, uploads as a workflow artifact. Isolated so it can later be replaced with a pre-built artifact download.
- **Job 2 (Integration Tests)**: Downloads the JAR, sets up the full toolchain (Go, Java 21, Temporal CLI, gotestsum), runs `make test-integration`, validates test count, uploads artifacts, and publishes a JUnit XML report.

## Implementation Details

### Workflow File

`.github/workflows/ci.integration-offline.yaml`

### Triggers

Path-filtered to avoid running on docs-only, web-only, or CLI-only changes:
- `backend/**`, `test/integration/**`, `apis/**`, `go.work`, `Makefile`
- Weekly schedule (Sunday 03:00 UTC) for cross-repo drift detection
- Manual dispatch with optional `cloud_ref` input for testing against specific stigmer-cloud refs

### Cross-Repo Authentication

`stigmer-cloud` is a private repo. The default `GITHUB_TOKEN` cannot access it. A fine-grained PAT (`STIGMER_CLOUD_TOKEN`) with read-only `contents` access to `stigmer/stigmer-cloud` was created and stored as a GitHub Actions secret.

### Caching Strategy

Three cache layers:
1. **BuildBuddy remote cache** — Already configured in stigmer-cloud's `.bazelrc` under `common`; CI gets read-only cache hits automatically
2. **Bazel disk cache** — `bazel-contrib/setup-bazel@0.19.0` persists build artifacts via GitHub Actions cache between runs
3. **Repository cache** — External repository downloads (Maven, Go deps) cached between runs

### Silent-Skip Guard

The test harness calls `os.Exit(0)` when the JAR is missing — zero tests, zero failures, green CI. A guard step parses the JUnit XML and asserts `tests > 0` when the test step succeeds, converting a false-green into an explicit failure.

### Test Reporting

`dorny/test-reporter@v3` consumes JUnit XML and renders per-test pass/fail results as a GitHub check annotation directly on the PR.

## Benefits

- **Automated regression detection**: Integration tests run on every backend-touching PR
- **Structured reporting**: Per-test results visible on PRs without clicking into logs
- **Debuggable failures**: Service logs, workflow-runner logs, and JSON event output uploaded as artifacts (30-day retention)
- **Cross-repo drift detection**: Weekly schedule catches incompatibilities between stigmer and stigmer-cloud
- **Replaceable JAR source**: Job 1 can be swapped from build-from-source to download-from-release without touching Job 2

## Impact

- **CI coverage**: The first workflow in the repo that validates backend integration (all existing workflows are release pipelines or docs CI)
- **Developer confidence**: Backend changes to workflow-runner, stigmer-server, or API contracts are validated against the full execution pipeline before merge
- **Cross-repo contract**: Proto and behavioral changes that break the stigmer-cloud integration surface are caught in CI, not in production

## Related Work

- T01–T04: Integration test harness, fixture deployer, assertions, JUnit XML output
- `_changelog/2026-05/2026-05-14-122325-e2e-architecture-spike-test-harness.md`
- `_changelog/2026-05/2026-05-14-155653-junit-xml-output-service-log-collection.md`

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~40 minutes)
