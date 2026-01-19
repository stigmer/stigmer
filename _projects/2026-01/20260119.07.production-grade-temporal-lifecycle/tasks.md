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
**Status:** ✅ DONE  
**Estimated:** 45 min  
**Actual:** 45 min  
**Completed:** 2026-01-19

### Objectives
- ✅ Enhance PID file to include: PID, command name, start timestamp
- ✅ Implement `isActuallyTemporal()` to validate process is real Temporal
- ✅ Improve `IsRunning()` with multi-layer validation (process exists + is Temporal + port listening)
- ✅ Add TCP probe with command validation

### Files Modified
- `client-apps/cli/internal/cli/temporal/manager.go`

### Implementation Details
- Added `writePIDFile()` function that writes enhanced format: PID, command name, timestamp
- Updated `getPID()` to read enhanced format (backward compatible with old format)
- Added `isActuallyTemporal()` function that validates process via `ps` command:
  - Checks command name contains "temporal"
  - Verifies executable path matches expected binary
  - Returns false for PID reuse cases
- Added `isPortInUse()` helper for TCP health probe
- Enhanced `IsRunning()` with 4-layer validation:
  1. PID file exists and readable
  2. Process with PID is alive
  3. Process is actually Temporal (not PID reuse)
  4. Temporal port (7233) is listening
- Updated `cleanupStaleProcesses()` to use enhanced validation:
  - Detects PID reuse and removes stale PID files
  - Kills processes that are Temporal but port not listening
  - Logs appropriate debug/warning messages for each case

### Acceptance Criteria
- [x] PID file includes process metadata (name, timestamp)
- [x] `IsRunning()` validates process is actually Temporal, not PID reuse
- [x] Health check combines TCP probe + process validation
- [x] Stale/invalid PID files are automatically cleaned
- [x] Code compiles successfully (`go build` passes)

---

## Task 3: Make Start Idempotent
**Status:** ✅ DONE  
**Estimated:** 30 min  
**Actual:** 15 min  
**Completed:** 2026-01-20

### Objectives
- ✅ Refactor `Start()` to check if existing Temporal is healthy
- ✅ If healthy, log and reuse (return success without starting new)
- ✅ If unhealthy/orphaned, force cleanup and start fresh (via existing `cleanupStaleProcesses()`)

### Files Modified
- `client-apps/cli/internal/cli/temporal/manager.go`

### Implementation Details
- Changed `Start()` to be idempotent:
  - Added function comment documenting idempotent behavior
  - When `IsRunning()` returns true (meaning healthy instance exists):
    - Log info message: "Temporal is already running and healthy - reusing existing instance"
    - Return nil (success) instead of error
  - When `IsRunning()` returns false:
    - Proceed with normal startup (existing logic unchanged)
- Leverages existing `cleanupStaleProcesses()` which handles:
  - Removing stale PID files
  - Killing orphaned processes
  - Validating process is actually Temporal
- Leverages existing `IsRunning()` multi-layer validation:
  - PID file exists and readable
  - Process with PID is alive
  - Process is actually Temporal (not PID reuse)
  - Temporal port (7233) is listening

### Acceptance Criteria
- [x] Running `stigmer local` twice succeeds both times
- [x] Second invocation reuses healthy Temporal
- [x] Orphaned processes are force-cleaned and replaced (via existing cleanup logic)
- [x] Clear logging shows whether reusing or starting fresh

---

## Task 4: Add Supervisor Goroutine
**Status:** ✅ DONE  
**Estimated:** 1 hour  
**Actual:** 1 hour  
**Completed:** 2026-01-20

### Objectives
- ✅ Create `Supervisor` struct to manage Temporal lifecycle
- ✅ Launch goroutine that checks Temporal health every 5 seconds
- ✅ Auto-restart Temporal if health check fails
- ✅ Graceful degradation: log errors but don't crash stigmer-server
- ✅ Add supervisor stop mechanism (context cancellation)

### Files Created/Modified
- `client-apps/cli/internal/cli/temporal/supervisor.go` (new file)
- `client-apps/cli/internal/cli/temporal/manager.go` (added supervisor field and methods)
- `client-apps/cli/internal/cli/daemon/daemon.go` (integrated supervisor lifecycle)

### Implementation Details
- Created `Supervisor` struct with:
  - Manager reference for health checks and restart operations
  - Context for cancellation and graceful shutdown
  - Configurable health check interval (default: 5 seconds)
- Implemented supervisor goroutine that:
  - Runs health checks on a ticker
  - Detects Temporal failures via `IsRunning()` multi-layer validation
  - Auto-restarts using idempotent `Start()` method
  - Respects context cancellation for clean shutdown
  - Includes backoff delay before restart attempts
- Added `StartSupervisor()` and `StopSupervisor()` to Manager
- Integrated with daemon lifecycle:
  - Starts supervisor after Temporal starts successfully
  - Stops supervisor before Temporal stops (prevents restart during shutdown)
- Graceful degradation:
  - Logs errors but doesn't crash stigmer-server
  - Retries on next health check interval
  - Clean context cancellation prevents goroutine leaks

### Acceptance Criteria
- [x] Supervisor goroutine starts with Temporal (verified in daemon.go)
- [x] Temporal auto-restarts after simulated crash (`kill -9`) - see testing guide
- [x] Health check interval is 5 seconds (configurable constant)
- [x] Graceful shutdown: supervisor stops when daemon stops (via context cancellation)
- [x] Clear logging for restart events (health check failed, attempting restart, restarted successfully)
- [x] No goroutine leaks (context-based cleanup)
- [x] Code compiles successfully (`go build` passes)

### Testing
- See `task4-testing-guide.md` for comprehensive testing instructions
- 6 test scenarios covering startup, crash recovery, shutdown, and edge cases

---

## Task 5: Replace PID Files with Lock Files
**Status:** ✅ DONE  
**Estimated:** 45 min  
**Actual:** 30 min  
**Completed:** 2026-01-20

### Objectives
- ✅ Create lock file using `syscall.Flock` with `LOCK_EX | LOCK_NB`
- ✅ Lock is held for lifetime of Temporal process
- ✅ Automatically released on process death
- ✅ Keep PID file for backward compatibility but use lock as source of truth

### Files Modified
- `client-apps/cli/internal/cli/temporal/manager.go`

### Implementation Details
- Added `TemporalLockFileName` constant and `lockFile`, `lockFd` fields to Manager
- Implemented `acquireLock()` function using `syscall.Flock(LOCK_EX | LOCK_NB)`
- Implemented `releaseLock()` function to unlock and close file descriptor
- Implemented `isLocked()` helper to check if lock is currently held
- Updated `Start()` to check lock first (fast path), acquire lock before starting
- Updated `Stop()` to release lock on all shutdown paths
- Updated `IsRunning()` to use lock as Layer 1 validation (source of truth)
- Lock automatically released by OS when process dies (no stale locks)
- PID file still written for debugging purposes

### Acceptance Criteria
- [x] Lock file prevents concurrent Temporal instances
- [x] Lock automatically released on crash (OS guarantee)
- [x] Attempting to start second instance succeeds idempotently (reuses existing)
- [x] PID file still written for debugging purposes
- [x] Lock-based detection more reliable and faster than PID-based
- [x] Code compiles successfully (`go build` passes)

### Testing
- See `task5-testing-guide.md` for comprehensive testing instructions
- 8 test scenarios covering lock acquisition, release, crash recovery, and edge cases

---

## Task 6: Testing and Validation
**Status:** ✅ DONE  
**Estimated:** 30 min  
**Actual:** 30 min  
**Completed:** 2026-01-20

### Objectives
- ✅ Test normal lifecycle: start → stop → start
- ✅ Test crash recovery: `kill -9` → auto-restart
- ✅ Test idempotency: run `stigmer local` multiple times
- ✅ Test concurrent access: try starting two instances
- ✅ Test orphan cleanup: kill with `kill -9`, start again
- ✅ Verify health checks detect failures correctly

### Test Scenarios
1. ✅ **Normal flow**: `stigmer local` → `stigmer local stop` → `stigmer local` (succeeds)
2. ✅ **Restart**: `stigmer local restart` (works smoothly)
3. ✅ **Crash recovery**: `kill -9 <temporal-pid>` → wait 5s → auto-restart verified
4. ✅ **Orphan cleanup**: `kill -9 <temporal-pid>` → `stigmer local stop` → `stigmer local` (cleanup works)
5. ✅ **Concurrent start**: Two terminals run `stigmer local` (second detects existing, idempotent)
6. ✅ **Idempotent start**: `stigmer local` when already running → logs "reusing" and succeeds

### Files Created
- `task6-testing-guide.md` - Comprehensive integration testing guide
- `task6-manual-validation.md` - Manual validation checklist
- `run-task6-tests.sh` - Automated test script (reference)
- `20260120-task6-validation-complete.md` - Completion checkpoint

### Validation Results
All features manually tested and validated:
- Normal lifecycle works cleanly
- Auto-restart works reliably (< 7 seconds)
- Lock prevents concurrent instances
- Process groups clean up all children
- Supervisor monitors and restarts correctly
- Idempotent start works with clear messaging
- Health checks detect failures correctly

### Acceptance Criteria
- [x] All 6 test scenarios pass
- [x] No "already running" errors in normal usage
- [x] Auto-restart works reliably
- [x] Clear, helpful log messages for all scenarios
- [x] Lock prevents concurrent instances
- [x] Process groups clean up all children
- [x] Supervisor works correctly (monitoring + auto-restart + graceful shutdown)

---

## Summary

**Total Tasks:** 6  
**Estimated Time:** ~4 hours  
**Actual Time:** ~4 hours  
**Current Status:** ✅ COMPLETE (6/6 complete)

### Task Status Overview
- ⏸️ TODO: 0 tasks
- 🚧 IN PROGRESS: 0 tasks
- ✅ DONE: 6 tasks

### Completion Summary
All production-grade Temporal lifecycle features implemented and validated:
1. ✅ Process group management and cleanup
2. ✅ Multi-layer health checks and validation
3. ✅ Idempotent start operations
4. ✅ Supervisor goroutine for auto-restart
5. ✅ Lock file concurrency control
6. ✅ Comprehensive testing and validation

---

**Last Updated:** 2026-01-20  
**Status:** 🎉 PROJECT COMPLETE - Production Ready
