# Tasks

## Task 1: Add Process Group Management and Cleanup
**Status:** ✅ DONE  
**Estimated:** 30 min  
**Actual:** 45 min  
**Completed:** 2026-01-19

### Objectives
- ✅ Add `Setpgid: true` to `cmd.SysProcAttr` when starting Temporal
- ✅ Update `Stop()` to kill entire process group with `syscall.Kill(-pid, SIGTERM)`
- ✅ Add startup cleanup: detect stale PID files and force cleanup orphaned processes
- ✅ Test that all child processes are killed on stop

### Files Modified
- `client-apps/cli/internal/cli/temporal/manager.go`

### Implementation Details
- Added `cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}` to Start() before cmd.Start()
- Updated Stop() to use `syscall.Kill(-pid, syscall.SIGTERM)` and `syscall.Kill(-pid, syscall.SIGKILL)` for process group killing
- Added `cleanupStaleProcesses()` function that:
  - Reads PID file and checks if process exists
  - Validates process is actually Temporal by checking port usage
  - Force kills orphaned processes and removes stale PID files
- Added error handling for macOS-specific "operation not permitted" when process is already dead

### Acceptance Criteria
- [x] Temporal starts in its own process group (verified: PID == PGID)
- [x] `stigmer local stop` kills all Temporal child processes (verified via process group SIGTERM)
- [x] Stale PID files are detected and cleaned up on next start (verified with kill -9 test)
- [x] Manual kill of Temporal doesn't prevent next start (verified with comprehensive test)

---

## Task 2: Implement Health Checks and Validation
**Status:** ⏸️ TODO  
**Estimated:** 45 min

### Objectives
- Enhance PID file to include: PID, command name, start timestamp
- Implement `isActuallyTemporal()` to validate process is real Temporal
- Improve `IsRunning()` with multi-layer validation (process exists + is Temporal + port listening)
- Add TCP probe with command validation

### Files to Modify
- `client-apps/cli/internal/cli/temporal/manager.go`

### Acceptance Criteria
- [ ] PID file includes process metadata (name, timestamp)
- [ ] `IsRunning()` validates process is actually Temporal, not PID reuse
- [ ] Health check combines TCP probe + process validation
- [ ] Stale/invalid PID files are automatically cleaned

---

## Task 3: Make Start Idempotent
**Status:** ⏸️ TODO  
**Estimated:** 30 min

### Objectives
- Refactor `Start()` to check if existing Temporal is healthy
- If healthy, log and reuse (return success without starting new)
- If unhealthy/orphaned, force cleanup and start fresh
- Add `forceCleanup()` helper for aggressive cleanup

### Files to Modify
- `client-apps/cli/internal/cli/temporal/manager.go`

### Acceptance Criteria
- [ ] Running `stigmer local` twice succeeds both times
- [ ] Second invocation reuses healthy Temporal
- [ ] Orphaned processes are force-cleaned and replaced
- [ ] Clear logging shows whether reusing or starting fresh

---

## Task 4: Add Supervisor Goroutine
**Status:** ⏸️ TODO  
**Estimated:** 1 hour

### Objectives
- Create `Supervisor` struct to manage Temporal lifecycle
- Launch goroutine that checks Temporal health every 5 seconds
- Auto-restart Temporal if health check fails
- Graceful degradation: log errors but don't crash stigmer-server
- Add supervisor stop mechanism (context cancellation)

### Files to Modify
- `client-apps/cli/internal/cli/temporal/manager.go` (add Supervisor)
- `client-apps/cli/internal/cli/temporal/supervisor.go` (new file)
- `client-apps/cli/internal/cli/daemon/daemon.go` (integrate supervisor)

### Acceptance Criteria
- [ ] Supervisor goroutine starts with Temporal
- [ ] Temporal auto-restarts after simulated crash (`kill -9`)
- [ ] Health check interval is 5 seconds
- [ ] Graceful shutdown: supervisor stops when daemon stops
- [ ] Clear logging for restart events

---

## Task 5: Replace PID Files with Lock Files
**Status:** ⏸️ TODO  
**Estimated:** 45 min

### Objectives
- Create lock file using `syscall.Flock` with `LOCK_EX | LOCK_NB`
- Lock is held for lifetime of Temporal process
- Automatically released on process death
- Keep PID file for backward compatibility but use lock as source of truth

### Files to Modify
- `client-apps/cli/internal/cli/temporal/manager.go`

### Acceptance Criteria
- [ ] Lock file prevents concurrent Temporal instances
- [ ] Lock automatically released on crash
- [ ] Attempting to start second instance fails gracefully
- [ ] PID file still written for debugging purposes

---

## Task 6: Testing and Validation
**Status:** ⏸️ TODO  
**Estimated:** 30 min

### Objectives
- Test normal lifecycle: start → stop → start
- Test crash recovery: `kill -9` → auto-restart
- Test idempotency: run `stigmer local` multiple times
- Test concurrent access: try starting two instances
- Test orphan cleanup: kill with `kill -9`, start again
- Verify health checks detect failures correctly

### Test Scenarios
1. **Normal flow**: `stigmer local` → `stigmer local stop` → `stigmer local` (should succeed)
2. **Restart**: `stigmer local restart` (should work smoothly)
3. **Crash recovery**: `kill -9 <temporal-pid>` → wait 5s → verify auto-restart
4. **Orphan cleanup**: `kill -9 <temporal-pid>` → `stigmer local stop` → `stigmer local` (should cleanup and start)
5. **Concurrent start**: Open two terminals, run `stigmer local` in both (second should detect existing)
6. **Idempotent start**: `stigmer local` (already running) → should log "reusing" and succeed

### Acceptance Criteria
- [ ] All 6 test scenarios pass
- [ ] No "already running" errors in normal usage
- [ ] Auto-restart works reliably
- [ ] Clear, helpful log messages for all scenarios

---

## Summary

**Total Tasks:** 6  
**Estimated Time:** ~4 hours  
**Current Status:** In Progress (1/6 complete)

### Task Status Overview
- ⏸️ TODO: 5 tasks
- 🚧 IN PROGRESS: 0 tasks
- ✅ DONE: 1 task

---

**Last Updated:** 2026-01-19  
**Next Task:** Task 2 - Implement Health Checks and Validation
