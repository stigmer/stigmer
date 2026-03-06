# Fix Daemon Process Supervision

**Date**: March 7, 2026

## Summary

Rewrote the daemon's child process supervision to eliminate zombie accumulation, provide reliable death detection, and auto-restart persistently unhealthy components. The stigmer-server was becoming permanently unreachable because the daemon could not distinguish a zombie from a running process and had no escalation path for the "alive but unresponsive" state.

## Problem Statement

The Stigmer Server would intermittently become unreachable (`context deadline exceeded` on `stigmer apply`), and the daemon would report it as "unhealthy" indefinitely without ever restarting it. Manual investigation revealed the server process was a zombie (`Z <defunct>`), but the daemon believed it was still alive.

### Pain Points

- `isProcessAlive()` uses `kill -0`, which returns success for zombie processes, giving a false positive
- `cmd.Start()` was called without a corresponding `cmd.Wait()`, so terminated children were never reaped and became zombies
- The health monitor could detect "alive but gRPC not responding" but had no code path to escalate this to a kill-and-restart — it just logged a warning and continued forever
- All child processes shared the daemon's process group, so stray signals to the group could inadvertently reach children
- The server's shutdown log said "Received shutdown signal" without identifying which signal, making root-cause analysis impossible

## Solution

Gave `managedComponent` proper lifecycle semantics with an event-driven exit notification channel (`exited`) fed by `cmd.Wait()`, replacing the unreliable `kill -0` polling for the daemon's own children. Added an unhealthy-check counter that escalates to kill-and-restart after 3 consecutive failures (~30 seconds). Isolated each child in its own process group via `Setpgid`.

## Implementation Details

### New lifecycle fields and methods on `managedComponent`

- `exited chan struct{}` — closed when `cmd.Wait()` returns, providing a reliable, non-blocking death signal
- `exitErr error` — captures the exit status from `cmd.Wait()`
- `unhealthyCount int` — tracks consecutive gRPC health check failures
- `hasExited() bool` — non-blocking channel check, replaces `isProcessAlive` for daemon-owned children
- `waitForExit()` — goroutine that calls `cmd.Wait()` to reap the child and close the `exited` channel
- `killAndWait()` — sends SIGTERM, waits on `exited` with timeout, falls back to SIGKILL
- `restartComponent() bool` — centralized restart logic (PID file cleanup, restart count, new `startFn`, new `exited` channel and goroutine)

### Process group isolation

Added `cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}` in `startChildProcessWithDir`. Each child now runs in its own process group (PGID == own PID), matching what the Temporal manager already does. This prevents signals sent to the daemon's group from reaching children.

### Rewritten health monitor

The per-component health check loop now uses `hasExited()` as the primary death detector (event-driven, no false positives on zombies). For stigmer-server, the gRPC port probe remains as a secondary liveness check with a new escalation path: after `maxUnhealthyChecks` (3) consecutive failures, the process is killed and restarted. Both the "process exited" and "unhealthy escalation" paths go through the shared `tryRestart` → `restartComponent` pipeline.

### Graceful shutdown rewrite

The shutdown path now uses `killAndWait()` (channel-based) instead of polling `isProcessAlive`. The old `stopProcess` function was removed.

### Signal identification in server logs

Changed the server's shutdown handler from `<-done` to `sig := <-done` so logs now include `signal=terminated` (or whichever signal), enabling future root-cause analysis.

## Files Changed

- `client-apps/cli/internal/cli/daemon/daemon_process.go` — bulk of changes (lifecycle fields, methods, health monitor rewrite, shutdown rewrite)
- `backend/services/stigmer-server/pkg/server/server.go` — log which signal triggered shutdown

## Benefits

- **No more zombie processes**: Every child has a `cmd.Wait()` goroutine that reaps it immediately on exit
- **Reliable death detection**: `hasExited()` is based on an event (channel close), not polling a syscall that lies about zombies
- **Self-healing for unresponsive servers**: After ~30s of consecutive gRPC failures, the daemon kills and restarts the component automatically
- **Process group isolation**: Children can no longer be accidentally killed by signals targeting the daemon's group
- **Debuggable shutdowns**: Server logs now identify the specific signal that caused the shutdown

## Impact

This fix addresses the recurring "Stigmer Server Unhealthy" issue where the server would become permanently unreachable until a manual `stigmer server stop && stigmer server start`. The daemon is now a proper process supervisor that can detect child death reliably and recover automatically from both crashes and unresponsive states.

## Verification

- Built and installed the new binary via `make release-local`
- Started the server; confirmed all components running with correct process groups (each child PGID == own PID)
- Killed the stigmer-server process manually; confirmed the daemon detected the exit and restarted it within one health check cycle (~10s)
- Verified no zombie processes remained after the restart
- Confirmed `stigmer apply` connected successfully after auto-restart
- Server logs show `signal=terminated` on shutdown

## Related Work

- [Consolidate Lifecycle Management Single Daemon](2026-03-01-194354-consolidate-lifecycle-management-single-daemon.md) — the original daemon architecture
- [Fix Agent Runner Bootstrap and Health Reporting](2026-03-02-000347-fix-agent-runner-bootstrap-and-health-reporting.md) — earlier health reporting improvements
- [Fix Temporal Supervision and Status Reporting](2026-03-05-040731-fix-temporal-supervision-and-status-reporting.md) — Temporal supervisor improvements

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (diagnosis + planning + implementation + verification)
