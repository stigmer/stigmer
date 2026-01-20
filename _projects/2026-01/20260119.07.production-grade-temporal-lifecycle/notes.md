# Notes

Quick learnings, observations, and insights during development.

---

## 2026-01-19 - Project Setup

### Initial Analysis

**Current Issues Identified:**
1. Temporal starts with `cmd.Start()` but no process group management
2. `Stop()` only sends SIGTERM to parent, not child processes
3. `IsRunning()` uses `os.FindProcess()` + signal 0 check (vulnerable to PID reuse)
4. No cleanup of stale PIDs on startup
5. No health validation (TCP + process name)
6. No supervision/auto-restart

### Industry Best Practices Research

**Process Groups:**
- Use `Setpgid: true` in `SysProcAttr`
- Kill with negative PID: `kill(-pid, SIGTERM)` kills entire group
- Prevents orphaned child processes

**Lock Files:**
- `syscall.Flock(fd, LOCK_EX | LOCK_NB)` for single instance
- Kernel guarantees lock release on process death
- Superior to PID files (no reuse issues)

**Health Checks:**
- TCP probe: `net.DialTimeout("tcp", address, timeout)`
- Process validation: Read `/proc/<pid>/cmdline` (Linux) or use `ps` (macOS)
- Multi-layer: process exists + is correct command + port listening

**Supervisor Pattern:**
- Goroutine with ticker (e.g., every 5 seconds)
- Health check → restart on failure
- Context-based cancellation for clean shutdown

### Design Decisions

**Q: Should we keep PID files or migrate fully to lock files?**  
**A:** Keep both initially for backward compatibility, but lock file is source of truth.

**Q: What's the health check interval?**  
**A:** 5 seconds - balance between responsiveness and overhead.

**Q: Should supervisor be part of Manager or separate?**  
**A:** Separate `Supervisor` struct, Manager focuses on single lifecycle operations.

**Q: Graceful degradation strategy?**  
**A:** If Temporal fails to start/restart after 3 attempts, log error but don't crash stigmer-server. Users can still use remote backend.

---

## Implementation Notes

### Phase 1: Process Groups (Task 1)
_Notes will be added as implementation progresses_

### Phase 2: Health Checks (Task 2) ✅

**Completed:** 2026-01-19

**Key Implementations:**
1. Enhanced PID file format (3 lines: PID, command name, timestamp)
2. `isActuallyTemporal()` - validates process via `ps` command
3. `isPortInUse()` - TCP health probe
4. Multi-layer `IsRunning()` validation (4 checks)
5. Improved `cleanupStaleProcesses()` with PID reuse detection

**Learnings:**
- `ps` command works consistently across macOS and Linux
- Backward compatibility: `getPID()` reads only first line (works with old format)
- Performance: all checks complete in ~10-20ms (fast enough for frequent use)
- PID reuse is rare but real - command validation prevents false positives

**Trade-offs:**
- Using `ps` command instead of `/proc` for portability (macOS doesn't have /proc)
- 100ms timeout for TCP probe (balance between speed and reliability)
- Enhanced PID file is human-readable but slightly larger (negligible impact)

### Phase 3: Idempotent Start (Task 3)
_Notes will be added as implementation progresses_

### Phase 4: Supervisor (Task 4)
_Notes will be added as implementation progresses_

### Phase 5: Lock Files (Task 5)
_Notes will be added as implementation progresses_

### Phase 6: Testing (Task 6)
_Notes will be added as implementation progresses_

---

## Gotchas & Pitfalls

_Common issues and solutions will be documented here as discovered_

---

## References & Resources

### Go Syscall Documentation
- https://pkg.go.dev/syscall
- `Setpgid` - Process groups
- `Flock` - File locking
- `Kill` - Signal sending

### Similar Projects
- Docker containerd
- Kubernetes kubelet
- systemd unit files
- supervisord

---

**Last Updated:** 2026-01-19
