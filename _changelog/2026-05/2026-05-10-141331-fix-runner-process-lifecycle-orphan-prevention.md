# Fix Runner Process Lifecycle: Orphan Prevention

**Date**: May 10, 2026

## Summary

Fixed three process lifecycle gaps in the runner package that caused orphaned agent-runner and cursor-runner processes when the parent `stigmer up` Go process died unexpectedly. Added SIGHUP signal handling, cursor-runner sidecar cleanup in stop paths, and orphan detection with automatic kill in the reap/adopt lifecycle.

## Problem Statement

The local runner is a tri-process system: a Go parent (`stigmer up`) manages the heartbeat stream and control socket, while spawning a Python agent-runner and an optional TypeScript cursor-runner as child processes. When the Go parent dies, the children survive as orphans reparented to PID 1 (launchd/init).

### Pain Points

- Terminal close (SIGHUP) killed the Go parent without triggering cleanup, orphaning both children
- `stigmer down runner` only killed the agent-runner PID, leaving the cursor-runner running indefinitely
- `isRunnerAlive()` returned true for orphaned processes (PID exists) even though the runner was non-functional (no heartbeat, no control socket)
- Orphaned runners consumed resources (observed 70% CPU on a stranded cursor-runner) and held stale Temporal connections
- The UI showed "Stopped" but `ReapStaleRunners` preserved the state file because the PID was alive, creating a zombie state where `stigmer up` would adopt a non-functional runner

## Solution

Three targeted fixes in the runner package, each addressing one layer of the orphan problem:

1. **Prevention**: Handle SIGHUP so terminal close triggers the existing graceful shutdown path
2. **Explicit cleanup**: Kill both processes when `stigmer down runner` is called
3. **Detection and recovery**: Identify orphaned processes during reap/adopt and kill them automatically

## Implementation Details

### SIGHUP Signal Handling (`start.go`)

Added `syscall.SIGHUP` to the signal notification set in both `waitForExitOrSignal` (native runner) and `waitForContainerExitOrSignal` (Docker runner). The existing `select` on `sigCh` already triggers graceful shutdown — this one-line addition per function covers the most common orphan scenario.

### Cursor-Runner Sidecar Stop (`stop.go`)

New `stopCursorRunnerSidecar(state)` function sends SIGTERM to `state.CursorRunnerPID`, waits up to 5 seconds, then SIGKILL. Called from `stopNativeRunner` in two places:
- After killing the main agent-runner PID (normal stop path)
- When the main PID is already dead but the cursor-runner may still be alive (cleanup path)

### Orphan Detection (`state.go`)

New `isOrphaned(pid)` function uses `ps -p <pid> -o ppid=` to check if a process's parent is PID 1 — portable across macOS and Linux without build tags.

Enhanced `isRunnerAlive()`: when the control socket is unreachable AND the PID is alive AND its parent is PID 1, the process is identified as an orphan. `killOrphanedRunner(state)` sends SIGTERM/SIGKILL to both the agent-runner and cursor-runner PIDs. The runner is then treated as dead, allowing `ReapStaleRunners` to clean the state file and `Ensure` to start fresh.

### Tests (`state_test.go`)

9 new tests covering `isOrphaned` (current process, dead PID, zero, negative), `isProcessAlive` (current process, dead PID, zero), and `CursorRunnerPID` serialization round-trip. All 37 runner package tests pass.

## Benefits

- Terminal close no longer orphans runner children (SIGHUP handling)
- `stigmer down runner` cleanly stops both agent-runner and cursor-runner
- Stale orphaned runners are automatically detected and killed on next `stigmer up` or `stigmer status`
- No changes required to the Python agent-runner or TypeScript cursor-runner codebases
- Backward compatible with pre-T04 runners (orphan detection only activates when `SocketPath` is set)

## Impact

- **CLI runner package**: 4 files modified (start.go, stop.go, state.go, state_test.go)
- **All local runner users**: Orphan prevention applies to all `stigmer up` invocations
- **Desktop app**: Benefits transitively — the Desktop's auto-ensure calls `stigmer up --json` which now handles SIGHUP

## Related Work

- Part of `20260509.02.runner-management-ux-overhaul` project (T08)
- Builds on T04 (control socket) which introduced `SocketPath` and socket-preferred liveness checks
- Future: Runner capability model (cursor-runner health in heartbeat) deferred to separate project

---

**Status**: Production Ready
**Timeline**: 1 session
