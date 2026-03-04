# Fix Temporal Process Supervision and Status Reporting

**Date**: March 5, 2026

## Summary

Moved Temporal process ownership from the short-lived CLI process into the long-lived daemon process, enabling automatic restart when Temporal crashes or becomes idle. Also fixed the status command to surface Temporal health as a first-class component, ending the false "all healthy" reporting when Temporal is dead.

## Problem Statement

When `stigmer server start` runs, it starts the Temporal dev server as a child of the CLI process, then spawns the daemon and exits. This orphans Temporal with no supervision -- if it dies (macOS sleep, OOM, idle timeout), all three services (`stigmer-server`, `workflow-runner`, `agent-runner`) permanently lose connectivity with "connection refused" errors on port 7233.

### Pain Points

- Temporal process orphaned when `stigmer server start` CLI exits -- adopted by init/launchd with no monitoring
- File lock (`temporal.lock`) released on CLI exit, making `IsRunning()` unreliable for subsequent checks
- Existing `Supervisor` with health-check and auto-restart logic was implemented but never wired in (`StartSupervisor()` never called)
- `stigmer server status` showed no Temporal section -- completely blind to Temporal health
- Workers displayed `Running ✓` even when unable to reach Temporal, because health was based on process liveness (`Signal(0)`) not functional connectivity
- Static hardcoded Web UI URL shown regardless of whether Temporal was actually running

## Solution

Two-part fix: (1) move Temporal lifecycle into the daemon process so it is supervised alongside the other components, and (2) add Temporal as a first-class component in the status command with live health probes.

## Implementation Details

### Part 1: Daemon Supervision (daemon.go, daemon_process.go)

- Removed `temporalManager.Start()` from `StartWithOptions()` in the foreground CLI process; kept `EnsureInstalled()` for binary download with progress display
- Added `STIGMER_TEMPORAL_MANAGED=true` environment variable to the daemon's environment
- In `RunDaemonProcess()`, before starting child components: creates a `temporal.Manager`, calls `Start()` (idempotent), records Temporal state in `HealthState`, and calls `StartSupervisor()` for 5-second health check interval with auto-restart
- Daemon now holds the flock for its entire lifetime, making `IsRunning()` reliable
- Shutdown order: `agent-runner` -> `workflow-runner` -> `stigmer-server` -> `StopSupervisor()` -> `Temporal.Stop()` -- workers drain before Temporal goes down
- Reordered `Stop()` to SIGTERM the daemon first (it handles Temporal shutdown internally), then `stopManagedTemporal()` as safety net

### Part 2: Status Command (server_status.go, server_health.go)

- Added `"temporal"` as the first entry in the component display order (foundational dependency)
- Daemon writes Temporal state to `health-state.json` alongside other components
- Fallback `createBasicHealthState()` performs a live TCP probe on port 7233 when `health-state.json` is unavailable
- Web UI URL display is now conditional on Temporal being in "running" state
- Fixed `readPIDFile()` to parse only the first line, supporting the Temporal PID file's multi-line format (`PID\ncommand\ntimestamp`)

### Part 3: Manager Enhancement (manager.go)

- Added exported `GetPID()` method so the daemon can record Temporal's PID in HealthState

## Benefits

- Temporal automatically restarts within 5 seconds of failure (Supervisor health check interval)
- `stigmer server status` accurately reflects Temporal health with standard status symbols
- No more silent failures where workers are alive but non-functional
- Clean shutdown sequence prevents orphaned processes
- Existing code reuse: no new abstractions, just wiring the existing Manager + Supervisor into the daemon lifecycle

## Impact

- **CLI users**: Temporal failures are now self-healing; no manual restart needed after macOS sleep or idle timeout
- **Status command**: Temporal appears as the first component section, showing PID, uptime, restarts, and last error
- **Daemon shutdown**: Temporal is properly stopped as part of the graceful shutdown sequence

## Related Work

- `2026-03-01-194354-consolidate-lifecycle-management-single-daemon.md` -- original daemon consolidation that missed Temporal ownership
- `2026-03-01-032812-fix-stale-temporal-cleanup-on-reset-and-restart.md` -- stale process cleanup that supplements this fix

---

**Status**: ✅ Production Ready
