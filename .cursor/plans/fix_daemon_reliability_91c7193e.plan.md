---
name: Fix daemon reliability
overview: "Fix three interrelated daemon reliability issues: (1) Temporal restart broken by stale lock on macOS, (2) health monitor not detecting unresponsive stigmer-server, (3) `stigmer run` not auto-starting daemon."
todos:
  - id: fix-lock-restart
    content: Fix manager.Start() to use IsRunning() instead of isLocked() gate, and release stale lock when daemon holds it but Temporal is dead (the macOS flock bug)
    status: completed
  - id: supervisor-panic-recovery
    content: Add defer/recover in supervisor.run() to prevent silent goroutine death on panic
    status: completed
  - id: health-monitor-grpc-probe
    content: Add TCP probe to gRPC port in health monitor for stigmer-server (daemon_process.go) and fix hardcoded 'running' in fallback (server_health.go)
    status: completed
  - id: run-ensure-running
    content: Add daemon.EnsureRunning() call in connectToBackend() for local backend mode, and add retry/backoff on connection
    status: completed
  - id: test-and-verify
    content: Build and verify the fixes compile, check for regressions in the lock/start/stop lifecycle
    status: completed
isProject: false
---

# Fix Daemon Reliability: Temporal Restart, Health Checks, and Auto-Start

## Root Cause Analysis

### Bug 1: Temporal supervisor cannot restart after crash (macOS flock semantics)

The lock file mechanism uses `flock()`, which on macOS/BSD is **per-open-file-description** (not per-process like Linux). When Temporal crashes:

1. Daemon still holds the lock on `m.lockFd` (the old fd from initial start)
2. Supervisor detects `IsRunning() == false`, calls `manager.Start()`
3. `Start()` calls `isLocked()`, which opens a **new** fd and tries `flock(LOCK_EX|LOCK_NB)`
4. On macOS, this returns `EWOULDBLOCK` because the daemon's original `m.lockFd` holds the lock on a different fd
5. `isLocked()` returns `true`, so `Start()` returns nil ("already running")
6. Supervisor logs success but Temporal is still dead -- repeats every 5 seconds forever

The critical code in `[manager.go` lines 93-101](client-apps/cli/internal/cli/temporal/manager.go):

```93:101:client-apps/cli/internal/cli/temporal/manager.go
func (m *Manager) Start() error {
	// Check lock file first (fastest check, source of truth)
	if m.isLocked() {
		log.Info().
			Str("address", m.GetAddress()).
			Str("ui_url", "http://localhost:8233").
			Msg("Temporal is already running (lock file held) - reusing existing instance")
		return nil
	}
```

### Bug 2: Health monitor uses process-liveness only for stigmer-server

`[daemon_process.go` lines 409-416](client-apps/cli/internal/cli/daemon/daemon_process.go) only checks `isProcessAlive(c.cmd.Process.Pid)`. A process can be alive but hung, not listening, or unresponsive to gRPC. Additionally, the fallback in `[server_health.go` lines 118-120](client-apps/cli/cmd/stigmer/root/server_health.go) hardcodes stigmer-server to "running" with no probe at all.

### Bug 3: `stigmer run` does not call `EnsureRunning()`

Commands like `search`, `list`, `get`, `push`, `discover` all call `daemon.EnsureRunning()` before connecting. But `stigmer run` (in `[run_resolve.go](client-apps/cli/cmd/stigmer/root/run_resolve.go)`) goes straight to `backend.NewConnection()` with a 10-second hard timeout -- no auto-start, no retry.

---

## Fixes

### Fix 1: Replace `isLocked()` gate with `IsRunning()` in `manager.Start()`

**File:** `[client-apps/cli/internal/cli/temporal/manager.go](client-apps/cli/internal/cli/temporal/manager.go)`

Change `Start()` to use `IsRunning()` (which does a full health check: process alive + port listening) instead of `isLocked()`. When the manager itself holds a stale lock (Temporal crashed but daemon is alive), release the lock before attempting a fresh start.

```go
func (m *Manager) Start() error {
    // Full health check: process alive, port listening, etc.
    if m.IsRunning() {
        log.Info().
            Str("address", m.GetAddress()).
            Str("ui_url", "http://localhost:8233").
            Msg("Temporal is already running and healthy - reusing existing instance")
        return nil
    }

    // If WE hold a stale lock (Temporal crashed while daemon lives),
    // release it so the fresh start below can re-acquire cleanly.
    if m.lockFd != nil {
        log.Info().Msg("Releasing stale Temporal lock (process died while we held the lock)")
        m.releaseLock()
        _ = os.Remove(m.pidFile)
    }

    // Cleanup any stale processes before starting
    m.CleanupStaleProcesses()

    // Check if ANOTHER process holds the lock (external Temporal instance)
    if m.isLocked() {
        // Another process holds the lock. If Temporal is healthy on the port,
        // treat it as an external instance. Otherwise, it's truly stale.
        if m.isPortInUse() {
            log.Info().Msg("Temporal lock held by another process and port is active - reusing")
            return nil
        }
        log.Warn().Msg("Temporal lock held by another process but port is not active - cannot start")
        return errors.New("Temporal lock held by another process but service is not responding")
    }

    // ... rest of start logic (acquireLock, exec, waitForReady) stays the same
}
```

### Fix 2: Add panic recovery to supervisor goroutine

**File:** `[client-apps/cli/internal/cli/temporal/supervisor.go](client-apps/cli/internal/cli/temporal/supervisor.go)`

Add `defer recover()` in `run()` so a panic in `checkHealthAndRestart()` doesn't silently kill the supervisor.

### Fix 3: Add gRPC/TCP probe for stigmer-server in health monitor

**File:** `[client-apps/cli/internal/cli/daemon/daemon_process.go](client-apps/cli/internal/cli/daemon/daemon_process.go)`

In `runHealthMonitor()`, after the `isProcessAlive()` check passes, add a TCP dial to the gRPC port (`localhost:7234`) with a 500ms timeout. If the process is alive but the port is not responding, mark the component as `"unhealthy"` (not `"failed"` -- it may recover).

**File:** `[client-apps/cli/cmd/stigmer/root/server_health.go](client-apps/cli/cmd/stigmer/root/server_health.go)`

In `createBasicHealthState()`, replace the hardcoded `"running"` for stigmer-server with a TCP probe (same as already done for Temporal).

### Fix 4: Add `EnsureRunning()` to `stigmer run` path

**File:** `[client-apps/cli/cmd/stigmer/root/run_resolve.go](client-apps/cli/cmd/stigmer/root/run_resolve.go)`

In `connectToBackend()`, call `daemon.EnsureRunning(dataDir)` before `backend.NewConnection()` for local backend. This ensures the daemon is started if needed, matching the behavior of `search`, `list`, `get`, `push`, and `discover`.

### Fix 5: Add a retry with backoff in `connectToBackend()` for transient failures

**File:** `[client-apps/cli/cmd/stigmer/root/run_resolve.go](client-apps/cli/cmd/stigmer/root/run_resolve.go)`

After `EnsureRunning()`, wrap the `backend.NewConnection()` call with a short retry loop (e.g., 3 attempts with 2s backoff) so that if the daemon was just started or Temporal just recovered, the connection attempt doesn't immediately fail.