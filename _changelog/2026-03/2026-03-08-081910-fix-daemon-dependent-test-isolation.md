# Fix Daemon-Dependent Test Isolation

**Date**: March 8, 2026

## Summary

Fixed a flaky test failure in `make check` caused by daemon-dependent output format tests not being isolated from a running stigmer server. Tests that assume no daemon is running now gracefully skip when a daemon is detected on the default port.

## Problem Statement

Running `make check` on a development machine with an active stigmer daemon caused the `TestJSONOutput_WarningPaths/server_stop_not_running` test to fail.

### Pain Points

- `daemon.IsRunning()` has a gRPC port fallback that detects a real daemon even without a PID file in the test's temp directory
- The test expected a "warning" / "not running" response but got "success" / "Server stopped successfully"
- The test actually killed the running daemon as a side effect, making it destructive
- The failure was environment-dependent: CI (no daemon) passed, local dev (daemon running) failed

## Solution

Added a `skipIfDaemonRunning` test guard that probes the daemon port (`localhost:7234`) via TCP before running subtests that require no daemon to be present. Tests skip gracefully with a clear message when a daemon is detected.

## Implementation Details

- Added `daemonPortInUse()` helper using `net.DialTimeout` with a 500ms timeout to check if the daemon port is occupied
- Added `skipIfDaemonRunning(t)` helper that calls `t.Skipf` with a descriptive message referencing the port number
- Added `needsNoDaemon` boolean field to the test table structs in `TestJSONOutput_WarningPaths` and `TestQuietOutput_StdoutIsEmpty`
- Flagged the four daemon-dependent subtests: `server stop not running` and `server status not running` in both test functions

## Benefits

- `make check` passes reliably regardless of whether a daemon is running
- No more accidental daemon kills during test runs
- Clear skip messages explain why tests were skipped
- Zero impact on CI environments where no daemon runs

## Impact

- **Developers**: Can run `make check` without stopping their local daemon first
- **CI**: No change — tests still execute fully when no daemon is present

## Related Work

- Previous CI gate fix: `2026-03-07-041145-fix-make-check-lint-and-nil-guard.md`

---

**Status**: ✅ Production Ready
