---
name: Fix Daemon Process Supervision
overview: "Fix three interconnected bugs in the daemon's process supervision that cause the stigmer-server to become permanently unrecoverable after an unexpected exit: zombie creation (no cmd.Wait), unreliable death detection (kill -0 on zombies), and missing restart path for persistent unhealthy state."
todos:
  - id: lifecycle-fields
    content: Add exited channel, exitErr, unhealthyCount fields and hasExited/waitForExit/killAndWait methods to managedComponent
    status: completed
  - id: process-isolation
    content: "Add SysProcAttr{Setpgid: true} in startChildProcessWithDir"
    status: completed
  - id: wait-goroutines
    content: Launch wait goroutines after each child start in RunDaemonProcess startup loop
    status: completed
  - id: health-monitor
    content: Rewrite health monitor to use hasExited() and unhealthy escalation with maxUnhealthyChecks
    status: completed
  - id: restart-helper
    content: Extract restartComponent helper that manages exited channel lifecycle (used by both dead-process and unhealthy-escalation paths)
    status: completed
  - id: graceful-shutdown
    content: Update daemon graceful shutdown to wait on exited channels instead of polling isProcessAlive
    status: completed
  - id: server-signal-log
    content: Update server.go to log which signal triggered the shutdown (sig.String())
    status: completed
  - id: verify
    content: Build, start server, verify health monitoring works, manually kill stigmer-server process to confirm auto-restart
    status: completed
isProject: false
---

# Fix Daemon Process Supervision

## Domain Analysis (per Architect Role)

**The Critique:** The daemon acts as a process supervisor but violates the core invariant of supervision: *a supervisor must always know whether its children are alive or dead*. Today's code uses `kill -0` polling, which is fundamentally unreliable for the daemon's own children because it returns true for zombie processes. The `managedComponent` struct is anemic -- it stores a `cmd` but has no mechanism to observe its lifecycle. The health monitor has a logic gap: it can detect "alive but unhealthy" but cannot act on it, leading to a permanent stuck state.

**The Fix:** Give `managedComponent` proper lifecycle semantics: an exit-notification channel fed by `cmd.Wait()`, and an unhealthy-check counter with a kill-and-restart escalation path. This makes death detection event-driven and reliable, while keeping the polling health check as a secondary liveness probe for the gRPC port.

---

## Files to Change

- [client-apps/cli/internal/cli/daemon/daemon_process.go](client-apps/cli/internal/cli/daemon/daemon_process.go) -- primary file, bulk of changes
- [backend/services/stigmer-server/pkg/server/server.go](backend/services/stigmer-server/pkg/server/server.go) -- minor: log which signal was received

---

## Detailed Changes

### 1. Add lifecycle fields to `managedComponent`

In [daemon_process.go](client-apps/cli/internal/cli/daemon/daemon_process.go), extend the struct:

```go
type managedComponent struct {
    name    string
    cmd     *exec.Cmd
    pidFile string
    state   *ComponentState
    startFn func() (*exec.Cmd, error)

    // exited is closed when cmd.Wait() returns, confirming the child
    // has truly terminated and been reaped (no zombie).
    exited chan struct{}

    // exitErr stores the result of cmd.Wait().
    exitErr error

    // unhealthyCount tracks consecutive failed gRPC health checks.
    // Reset to 0 on recovery. Used to escalate to kill-and-restart.
    unhealthyCount int
}
```

Add two methods:

```go
func (c *managedComponent) hasExited() bool {
    select {
    case <-c.exited:
        return true
    default:
        return false
    }
}

func (c *managedComponent) waitForExit() {
    c.exitErr = c.cmd.Wait()
    close(c.exited)
}
```

Add a constant:

```go
const maxUnhealthyChecks = 3 // ~30s at 10s interval before kill-and-restart
```

### 2. Isolate child processes in their own process group

In `startChildProcessWithDir` (line 358), add `SysProcAttr` before `cmd.Start()`:

```go
cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
```

This matches what the Temporal manager already does (line 166 of `manager.go`) and prevents stray signals from the daemon's original process group from reaching children.

### 3. Launch wait goroutines after starting each child

In `RunDaemonProcess`, after each successful `c.startFn()` call (around line 157), initialize the exit channel and launch the reaper:

```go
c.cmd = cmd
c.exited = make(chan struct{})
go c.waitForExit()
```

This applies in two places:

- The initial startup loop (line 139-184)
- The restart logic inside `runHealthMonitor` (line 464-481)

### 4. Rewrite the health monitor's per-component logic

Replace the current `isProcessAlive`-based check (lines 412-486) with the new `hasExited()`-based logic. The new flow for each component on each tick:

```
if c.hasExited():
    -> Process is confirmed dead and reaped. Enter restart logic.
       (existing: rapid-crash check, max-restart check, then restart)
       On restart: create new c.exited channel, launch new waitForExit goroutine.

else if c.name == "stigmer-server":
    -> Process is alive. Check gRPC port.
    if gRPC port not responding:
        c.unhealthyCount++
        if c.unhealthyCount >= maxUnhealthyChecks:
            -> Log escalation. Kill process (SIGTERM, wait on c.exited with timeout, fallback SIGKILL).
            -> After kill confirmed via <-c.exited, enter restart logic.
        else:
            -> Mark "unhealthy", log warning. Wait for next tick.
    else:
        -> Healthy. Reset c.unhealthyCount = 0. Mark "running".

else:
    -> Non-server component that is alive. No further checks needed.
```

The kill-before-restart helper for the unhealthy escalation:

```go
func (c *managedComponent) killAndWait() {
    if c.cmd == nil || c.cmd.Process == nil {
        return
    }
    _ = c.cmd.Process.Signal(syscall.SIGTERM)
    select {
    case <-c.exited:
        return
    case <-time.After(gracefulStopTimeout):
        _ = c.cmd.Process.Kill()
        <-c.exited
    }
}
```

### 5. Update restart helper to manage channel lifecycle

Extract a `restartComponent` method on `managedComponent` (or a free function) that encapsulates:

1. Remove old PID file
2. Increment restart count
3. Call `c.startFn()`
4. On success: set `c.cmd`, `c.exited = make(chan struct{})`, `go c.waitForExit()`, update state
5. On failure: mark as "failed"

Both the "dead process" and "unhealthy escalation" paths call this same function, avoiding duplication.

### 6. Update graceful shutdown to use `exited` channels

In the shutdown block (lines 221-230), after sending SIGTERM, wait on `<-c.exited` with a timeout instead of polling `isProcessAlive`:

```go
for i := len(components) - 1; i >= 0; i-- {
    c := components[i]
    if c.cmd == nil || c.hasExited() {
        continue
    }
    _ = c.cmd.Process.Signal(syscall.SIGTERM)
    select {
    case <-c.exited:
        // reaped cleanly
    case <-time.After(gracefulStopTimeout):
        _ = c.cmd.Process.Kill()
        <-c.exited
    }
    _ = os.Remove(c.pidFile)
    c.state.State = "stopped"
}
```

This also eliminates the need for the standalone `stopProcess` function for managed children.

### 7. Log which signal is received in the server

In [server.go](backend/services/stigmer-server/pkg/server/server.go) line 434-468, change from a bare channel receive to capturing and logging the signal name:

```go
sig := <-done
log.Info().Str("signal", sig.String()).Msg("Received shutdown signal")
```

This matches the pattern the daemon already uses (line 216 of `daemon_process.go`) and will help us identify the signal source if the server keeps dying.

---

## What This Plan Does NOT Change

- **The `isProcessAlive()` function itself** -- it remains as-is for use by `cleanupOrphanedProcesses`, `Stop`, `IsRunning`, and `GetStatus`, which deal with external/orphaned PIDs (not the daemon's own children). For those use cases, `kill -0` is acceptable.
- **The Temporal supervisor** -- it already has its own `Setpgid` and restart logic via `Manager.StartSupervisor()`.
- **No new files** -- all changes are in existing files.

## Risks and Open Questions

- **Signal source**: These fixes make the daemon resilient to child death from any cause, but we still don't know what sends the shutdown signal. The server signal logging improvement (item 7) will give us data. If the mystery persists after deployment, we can add deeper instrumentation later.
- `**Setpgid` side effect**: Putting children in their own process group means `stigmer server stop` (which sends SIGTERM to the daemon) no longer inadvertently signals children via the shared process group. This is actually *correct* behavior -- the daemon's shutdown handler explicitly stops children in order. But worth noting as a behavioral change.

