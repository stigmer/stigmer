# Flake Management Infrastructure for Integration Tests

**Date**: May 17, 2026

## Summary

Added flake detection, quarantine, stress testing, and CI health reporting to the integration test suite. Tests that fail intermittently are now automatically detected via gotestsum reruns, tracked in a quarantine registry, excluded from the blocking CI gate via Go's native `-skip` flag, and surfaced in GitHub Actions job summaries with metrics.

## Problem Statement

The integration test suite (~112 tests across offline, provider, and agent lanes) had no mechanism to distinguish genuine test failures from infrastructure flakes. When a test failed intermittently, it either blocked PRs (false positive) or was ignored (false confidence). There was no tracking of which tests were unreliable, no automated detection, and no visibility into overall suite health.

### Pain Points

- Flaky tests block PRs with false positives, eroding developer confidence in CI
- No visibility into first-pass rate or duration trends
- No mechanism to temporarily quarantine known-flaky tests while investigating root causes
- No proactive detection of new flakes before they hit the blocking CI gate
- No structured health reporting on CI runs

## Solution

A layered flake management system integrated into the existing test infrastructure:

1. **Detection**: gotestsum `--rerun-fails=2` automatically retries failed tests and reports which ones are flaky
2. **Tracking**: A `quarantine.json` registry with expiry dates for known-flaky tests
3. **Enforcement**: Go's `-skip` flag excludes quarantined tests from the blocking CI gate
4. **Stress testing**: A weekly CI workflow runs tests 3x to proactively surface new flakes
5. **Reporting**: A Go CLI tool generates markdown health reports for GitHub Actions job summaries

## Implementation Details

### Quarantine Registry (`test/integration/quarantine.json`)

Machine-readable JSON file with structured entries: test name, reason, tracking issue, added date, and expiry date. The Makefile reads this via `jq` and generates a `-skip` regex. `SKIP_QUARANTINE=false` disables the skip for stress and debugging.

### gotestsum Rerun Configuration

All 6 primary test targets now include:
- `--rerun-fails=2` — retry failed tests up to 2 additional times
- `--rerun-fails-max-failures=5` — skip reruns if more than 5 tests fail (systemic breakage)
- `--rerun-fails-run-root-test` — rerun the entire root test when subtests fail (critical for table-driven tests sharing `TestMain` setup)
- `--rerun-fails-report` — output file listing rerun tests

### Report Tool (`test/integration/tools/flaketrack/`)

A standalone Go CLI (zero external dependencies, 15 unit tests) that:
- Parses gotestsum JSON output for timing and pass/fail data
- Reads the rerun report to identify flaky tests
- Reads quarantine.json for status tracking
- Computes first-pass rate, duration percentiles (p50/p90/p95/p99), and quarantine expiry warnings
- Outputs GitHub Flavored Markdown to stdout

### Stress CI Workflow (`ci.integration-stress.yaml`)

Weekly schedule (Sunday 3AM UTC) + manual dispatch. Runs offline tests with `-count=3` and no quarantine skip. Non-blocking — advisory only.

### CI Workflow Updates

Both `ci.integration-offline.yaml` and `ci.integration-providers.yaml` updated with:
- Pinned gotestsum version (v1.12.1) for reproducibility
- Flaketrack report step writing health metrics to `$GITHUB_STEP_SUMMARY`

## Benefits

- **Immediate**: False-positive CI failures from intermittent flakes are automatically retried — no human intervention needed for transient infrastructure issues
- **Visibility**: Every CI run now reports first-pass rate, duration percentiles, and flake occurrences in the job summary
- **Accountability**: Quarantine entries have expiry dates — tests cannot rot in quarantine indefinitely
- **Proactive**: Weekly stress runs surface new flakes before they disrupt development
- **Zero overhead**: No changes needed to existing test code — all enforcement happens at the Makefile/CI layer

## Impact

- **Developers**: PRs are no longer blocked by known-flaky tests; health report gives confidence in CI results
- **CI reliability**: First-pass rate becomes a tracked metric; regressions are visible immediately
- **Test maintainers**: Clear quarantine/unquarantine workflow with expiry-driven accountability

## Related Work

- T15: Temporal Workflow Replay CI Gate (session 25) — replay determinism testing
- T18: SDK Acceptance Smoke Tests (session 24) — SDK contract testing
- T19: Remaining Coverage Gaps (session 23) — expanded test coverage

---

**Status**: Production Ready
**Timeline**: 1 session (Session 26)
