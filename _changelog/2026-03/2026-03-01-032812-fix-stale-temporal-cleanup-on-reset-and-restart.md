# Fix Stale Temporal Process Cleanup on Reset and Restart

**Date**: March 1, 2026

## Summary

Fixed a bug where `stigmer server reset` and `stigmer server stop` failed to kill the managed Temporal process, leaving an orphan that blocked subsequent server starts. Added port-based fallback cleanup and made worker start failure non-fatal so the server can recover via its health monitor.

## Problem Statement

After running `stigmer server reset`, the next `stigmer server` would fail with `"failed to start worker 0: context deadline exceeded"` and the server process would crash (`log.Fatal`). The readiness gate (from the prior fix) correctly reported `"Server failed to become ready"`, but the root cause was upstream.

### Pain Points

- `stigmer server reset` followed by `stigmer server` was completely broken -- the server could not start.
- The stale Temporal process was invisible to all cleanup paths after reset removed its PID file.
- Worker start failure was treated as fatal (`log.Fatal`), killing the server even though the health monitor could recover.

## Solution

Fixed three layers of the problem:

1. **Root cause** -- `stopManagedTemporal()` and `cleanupOrphanedProcesses()` gated Temporal cleanup on `IsRunning()`, which requires the lock file to be held. The lock is released when the CLI process that originally started Temporal exits, making orphaned Temporal invisible to lock-based checks.

2. **Missing fallback** -- `cleanupStaleProcesses()` only handled the "PID file exists" case. After `reset` deletes the PID file, there was no way to find the orphan.

3. **Excessive severity** -- `log.Fatal` for worker start failure killed the server before the gRPC listener started. The health monitor already handles Temporal reconnection and worker restart.

## Implementation Details

### `client-apps/cli/internal/cli/temporal/manager.go`

- Exported `CleanupStaleProcesses()` for use by daemon package.
- Split into two clear paths: `cleanupByPID()` (existing logic, refactored) and `cleanupByPort()` (new).
- `cleanupByPort()` uses `lsof -ti tcp:<port> -sTCP:LISTEN` to resolve the PID, validates it's actually a Temporal process (`isActuallyTemporal`), then sends SIGTERM with SIGKILL fallback.
- `findPIDOnPort()` helper returns 0 if `lsof` fails or returns no results.

### `client-apps/cli/internal/cli/daemon/daemon.go`

- `stopManagedTemporal()`: Removed `IsRunning()` gate. Tries `Stop()` directly (PID-based, no lock dependency). On failure, falls back to `CleanupStaleProcesses()` for port-based cleanup.
- `cleanupOrphanedProcesses()`: Replaced `IsRunning()` + `Stop()` with `CleanupStaleProcesses()` which handles both PID and port scenarios.

### `backend/services/stigmer-server/pkg/server/server.go`

- Changed `log.Fatal` to `log.Warn` for Temporal worker start failure. The `TemporalManager.restartWorkers()` (used by the health monitor during reconnection) already treats individual worker failures as non-fatal (`continue`). The initial startup path should be consistent.

## Benefits

- `stigmer server reset && stigmer server` works reliably.
- Orphaned Temporal processes are detected and killed regardless of PID file / lock file state.
- Server survives transient Temporal issues and self-heals via the health monitor.

## Impact

- **Users**: Reset-then-start workflow is no longer broken. Server startup is resilient to stale Temporal processes.
- **Developers**: `CleanupStaleProcesses()` is now the single entry point for all Temporal orphan cleanup, with clear PID-first / port-fallback semantics.

## Related Work

- [2026-03-01: Fix Server Startup Race Condition](_changelog/2026-03/2026-03-01-031323-fix-server-startup-race-condition.md) -- Added the readiness gate that exposed this deeper issue.

---

**Status**: ✅ Production Ready
