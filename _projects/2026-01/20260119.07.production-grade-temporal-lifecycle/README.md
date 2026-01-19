# Production-Grade Temporal Lifecycle

**Created:** 2026-01-19  
**Status:** 🚧 In Progress  
**Tech Stack:** Go/Bazel  
**Estimated Duration:** 1-2 sessions

## Overview

Implement production-grade subprocess lifecycle management for Temporal dev server including process groups, health checks, lock files, and automatic restart supervision.

## Problem

Currently, `stigmer local` encounters "Temporal is already running" errors when:
- Temporal process crashes and leaves stale PID files
- Process is orphaned after parent crash
- PID is reused by another process
- `stigmer local stop` doesn't kill all child processes

This creates a poor developer experience requiring manual process cleanup.

## Goal

**Eliminate 'Temporal is already running' errors by implementing robust process lifecycle management with cleanup, health validation, and supervisor pattern for automatic restart.**

## Success Criteria

- ✅ `stigmer local` works idempotently (can be run multiple times safely)
- ✅ `stigmer local stop` cleanly kills all Temporal processes
- ✅ Temporal automatically restarts if it crashes
- ✅ No more "already running" errors from orphaned processes
- ✅ System gracefully handles crash scenarios and PID reuse

## Affected Components

- `client-apps/cli/internal/cli/temporal/manager.go` - Core lifecycle logic
- `client-apps/cli/internal/cli/daemon/daemon.go` - Integration with supervisor
- Related PID file and process management utilities

## Architecture Overview

### Current State (Broken)
```
stigmer local
  ├─ starts Temporal with cmd.Start()
  ├─ writes PID file
  └─ detaches (no supervision)

Issues:
- Process can crash silently
- Orphaned processes not detected
- PID reuse causes false positives
- No process group management
```

### Target State (Production-Grade)
```
stigmer local
  ├─ Checks for stale PIDs (cleanup)
  ├─ Starts Temporal in process group
  ├─ Writes lock file (flock)
  ├─ Health check (TCP + process validation)
  ├─ Supervisor goroutine
  │   ├─ Periodic health checks (every 5s)
  │   ├─ Auto-restart on failure
  │   └─ Graceful degradation
  └─ Idempotent (reuses healthy process)

Benefits:
- Crash recovery automatic
- Clean process tree management
- Single-instance guarantee
- Developer-friendly (just works)
```

## Tasks Breakdown

See [tasks.md](./tasks.md) for detailed task tracking.

## Key Design Decisions

### 1. Process Groups vs Individual PIDs
**Decision:** Use process groups (`Setpgid`) and kill entire group with `kill(-pid, SIGTERM)`

**Why:** Ensures all child processes are killed, prevents orphans.

### 2. Lock Files vs PID Files
**Decision:** Migrate from PID files to lock files using `flock`

**Why:** Kernel-guaranteed single instance, no PID reuse issues, automatic cleanup on process death.

### 3. Health Check Strategy
**Decision:** Multi-layer validation (TCP probe + process name + timestamp)

**Why:** Prevents false positives from PID reuse, validates actual Temporal process.

### 4. Supervisor Pattern
**Decision:** Goroutine-based supervisor with 5-second health check interval

**Why:** Automatic recovery, transparent to users, minimal overhead.

### 5. Idempotent Start
**Decision:** `Start()` can safely be called multiple times, reuses healthy processes

**Why:** Better developer experience, aligns with "just works" philosophy.

## References

### Industry Standards
- **Docker** - Uses containerd with supervisor pattern
- **Kubernetes** - kubelet supervises pods with restart policies
- **systemd** - Linux process manager with automatic restart
- **supervisord** - Python daemon manager (inspiration for our approach)

### Go Patterns
- `syscall.Setpgid` - Process group creation
- `syscall.Flock` - File locking for single instance
- `syscall.Kill(-pid, signal)` - Kill process group
- `net.DialTimeout` - TCP health checks

## Testing Plan

1. **Normal Lifecycle**
   - Start → Stop → Start (should succeed)
   - Restart command (should work smoothly)

2. **Crash Scenarios**
   - Kill Temporal with `kill -9` → Start (should cleanup and restart)
   - Kill stigmer-server → Temporal should continue until supervisor restarts
   - Simulate PID reuse (advanced)

3. **Concurrent Access**
   - Run `stigmer local` twice simultaneously (second should detect lock)
   - Verify only one instance runs

4. **Health Check Validation**
   - Block Temporal port → should detect unhealthy
   - Rename process → should detect wrong process

## Notes

Quick learnings and observations will be captured in [notes.md](./notes.md).

## Related Work

- **ADR 011:** Local Daemon Architecture
- **Issue #XX:** "Temporal already running" bug reports (if exists)
- Prior art: Agent-runner subprocess management in `daemon.go`

---

**Quick Resume:** To resume this project, drag [next-task.md](./next-task.md) into any chat.
