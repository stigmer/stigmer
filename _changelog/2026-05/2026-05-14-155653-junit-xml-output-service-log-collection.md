# JUnit XML Output and Deterministic Service Log Collection

**Date**: May 14, 2026

## Summary

Wired `gotestsum` into the integration test suite via a new `make test-integration` target, producing JUnit XML and JSON event logs. Service logs (Java service, workflow-runner) now write to a deterministic output directory instead of ephemeral temp dirs, making them available as CI artifacts for post-mortem failure diagnosis.

## Problem Statement

The integration test suite (`test/integration/`) ran via raw `go test` with no structured output. Service logs were written to random temp directories that were lost after test runs, making failure diagnosis in CI nearly impossible.

### Pain Points

- No machine-readable test reports for CI systems (GitHub Actions annotations, test summaries)
- Service logs (stigmer-service, workflow-runner) written to `os.MkdirTemp` — lost on process exit
- No way to correlate a test failure with the Java service output at that point in time
- No `make` target for integration tests — developers had to remember the full `go test` invocation

## Solution

Layered approach: `gotestsum` as an external runner (not a code dependency) + deterministic log paths in the harness + a single Makefile target that orchestrates everything.

## Implementation Details

**Harness changes** (`harness/harness.go`, `service.go`, `workflow_runner.go`):
- Added `OutputDir` to `Config` with env var override (`INTEGRATION_TEST_OUTPUT_DIR`)
- `Start()` creates `{OutputDir}/logs/` before launching infrastructure
- `ServiceConfig` and `WorkflowRunnerConfig` accept `LogDir` — falls back to temp dir when unset
- Added `LogPath()` on both `JavaService` and `WorkflowRunner`
- Added `LogDir()` and `LogPaths()` on `TestHarness` for service log discovery

**Suite changes** (`suite_test.go`):
- Passes `LogDir` from harness to both service configs

**Makefile** (`test-integration` target):
- Checks `gotestsum` is on PATH (helpful error if missing)
- Uses `$(abspath ...)` to resolve the output dir to an absolute path (avoids CWD mismatch between Make and Go test binary)
- Produces `junit.xml`, `test-output.json`, and `logs/` in a single output directory

**Output directory layout:**
```
test/integration/.test-output/
  junit.xml              # JUnit XML (consumed by dorny/test-reporter in CI)
  test-output.json       # Full JSON event log (gotestsum tool slowest)
  logs/
    stigmer-service.log  # Java service stdout/stderr
    workflow-runner.log   # Go workflow-runner stdout/stderr
```

## Benefits

- CI systems can parse JUnit XML for test annotations and failure summaries
- Service logs persist alongside test results for failure diagnosis
- Single `make test-integration` command replaces a long `go test` incantation
- Output directory is gitignored — no noise in version control
- `INTEGRATION_TEST_OUTPUT_DIR` env var allows CI to place artifacts anywhere

## Impact

- **Developers**: Run `make test-integration` instead of remembering flags
- **CI (T06)**: Foundation for GitHub Actions integration — upload `.test-output/` as artifact, parse `junit.xml` with `dorny/test-reporter`
- **Debugging**: Service logs are now reliably available alongside test results

## Related Work

- T03: Test harness core (fixture deployer, assertions) — this session's changes build on that foundation
- T06: CI Workflow (next task) — will consume the JUnit XML and artifact bundle produced here
- Session 4: Runtime validation — the 6 bugs fixed there would have been faster to diagnose with service logs collected this way

---

**Status**: Production Ready
**Timeline**: 1 session (~15 minutes implementation + validation)
