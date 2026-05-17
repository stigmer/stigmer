# DD: Flake Management Infrastructure

**Date**: 2026-05-16
**Status**: Accepted
**Context**: T16 — E2E Workflow Testing Infrastructure

## Decision

Add flake detection, quarantine, stress testing, and CI health reporting to
the integration test suite. Flaky tests are automatically detected via
gotestsum reruns, tracked in a quarantine registry, excluded from the
blocking CI gate via Go's `-skip` flag, and surfaced in GitHub Actions job
summaries.

## Components

### 1. gotestsum Rerun Configuration

All gotestsum invocations in the integration test Makefile now include:

```
--rerun-fails=2
--rerun-fails-max-failures=5
--rerun-fails-run-root-test
--rerun-fails-report <output>/rerun-report.txt
```

- **2 retries per failed test**: Enough to confirm flakiness without
  excessive cost.
- **Max-failures threshold of 5**: If more than 5 tests fail on first
  pass, reruns are skipped — the breakage is systemic, not flaky.
- **Run root test on subtest failure**: Critical for table-driven tests
  (`TestFoo/native`, `TestFoo/cursor`) that share setup via `TestMain`.

### 2. Quarantine Registry (`quarantine.json`)

A machine-readable JSON file at `test/integration/quarantine.json` listing
known-flaky tests. Each entry requires:

- `test`: Full test name (e.g., `TestAgentExecution_PauseTerminalFails/cursor`)
- `reason`: Why the test is flaky
- `issue`: Tracking issue URL
- `added`: Date quarantined
- `expires`: Date by which the root cause must be fixed or the quarantine
  extended

The Makefile reads this file and generates a `-skip` regex passed to
`go test`. The `SKIP_QUARANTINE` variable controls whether quarantine is
active (default: `true`). Setting `SKIP_QUARANTINE=false` runs all tests
including quarantined ones.

### 3. Stress Schedule (`ci.integration-stress.yaml`)

A weekly CI workflow that runs offline integration tests with `-count=3`
(3 repetitions) and no quarantine skip. This:

- Detects new flakes proactively
- Validates whether quarantined tests are still flaky
- Runs on a schedule (Sunday 3AM UTC) plus manual dispatch
- Is advisory only — never blocks merges

### 4. Report Tool (`flaketrack`)

A Go CLI at `test/integration/tools/flaketrack/` that parses gotestsum
output and generates a GitHub Flavored Markdown health report containing:

- Total / passed / failed / skipped / flaky counts
- First-pass rate percentage
- Duration percentiles (p50, p90, p95, p99)
- Flaky test table (tests that failed then passed on rerun)
- Quarantine status with expiry warnings

The report is written to `$GITHUB_STEP_SUMMARY` in CI and to stdout
locally.

## Alternatives Considered

### Separate quarantine CI workflow

A dedicated workflow that only runs quarantined tests. Rejected because:

- Duplicates 90% of the existing CI setup (JAR build, Testcontainers, etc.)
- More infrastructure to maintain
- `-skip` flag achieves the same isolation with zero duplication

### Shell script for reporting

Using `grep`/`awk`/`jq` to parse test output. Rejected because:

- Fragile parsing of JSON and XML
- Not testable
- Hard to extend for future features (trend tracking, etc.)

### `nick-fields/retry` for entire job

Retrying the entire CI job on failure. Rejected because:

- Hides all failures, not just flakes
- Burns CI minutes on full re-execution
- Does not identify which specific tests are flaky

## Files

| File | Purpose |
|------|---------|
| `test/integration/quarantine.json` | Quarantine registry |
| `test/integration/Makefile` | Rerun flags, quarantine skip, stress target |
| `test/integration/tools/flaketrack/` | Report generation CLI (4 Go files + tests) |
| `.github/workflows/ci.integration-stress.yaml` | Weekly stress schedule |
| `.github/workflows/ci.integration-offline.yaml` | Updated: pinned gotestsum, flaketrack report |
| `.github/workflows/ci.integration-providers.yaml` | Updated: pinned gotestsum, flaketrack report |
| `Makefile` | Added `test-integration-stress` delegate |

## Commands

```bash
# Run offline integration tests with rerun + quarantine skip (default)
make test-integration

# Run stress tests (3 repetitions, no quarantine skip)
make test-integration-stress

# Generate a report from existing test output
cd test/integration && make flaketrack-report

# Quarantine a test (edit the file manually)
vim test/integration/quarantine.json

# Run all tests including quarantined ones
SKIP_QUARANTINE=false make test-integration
```
