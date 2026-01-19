# Make Temporal Start() Idempotent

**Date:** 2026-01-20  
**Type:** Feature Enhancement  
**Scope:** CLI - Temporal Manager  
**Impact:** User Experience  
**Project:** `_projects/2026-01/20260119.07.production-grade-temporal-lifecycle`  
**Task:** Task 3 - Make Start Idempotent

---

## Summary

Made the Temporal `Start()` function idempotent, eliminating confusing "Temporal is already running" errors when executing `stigmer local` multiple times. The function now detects healthy running instances and reuses them instead of failing.

## Problem

**Before this change:**

```bash
$ stigmer local
# Temporal starts successfully

$ stigmer local
# Error: "Temporal is already running"
```

Users would encounter error messages when running `stigmer local` if Temporal was already running, even though the desired outcome (Temporal running) was already achieved. This created unnecessary friction and confusion.

## Solution

**Changed behavior:**

```bash
$ stigmer local
# Temporal starts successfully

$ stigmer local
# Info: "Temporal is already running and healthy - reusing existing instance"
# Success (returns 0)
```

The `Start()` function now:

1. Checks if Temporal is already running via `IsRunning()` (multi-layer health validation)
2. If running AND healthy → logs success message and returns nil (reuse existing)
3. If not running OR unhealthy → proceeds with cleanup and fresh start as before

## Changes

### Modified Files

**`client-apps/cli/internal/cli/temporal/manager.go`**

#### Before

```go
// Start starts the Temporal dev server as a background process
func (m *Manager) Start() error {
	// Cleanup any stale processes before checking if running
	m.cleanupStaleProcesses()
	
	// Check if already running
	if m.IsRunning() {
		return errors.New("Temporal is already running")
	}
	
	// ... rest of startup logic ...
}
```

#### After

```go
// Start starts the Temporal dev server as a background process
// This function is idempotent - if Temporal is already running and healthy,
// it will log success and return without error.
func (m *Manager) Start() error {
	// Cleanup any stale processes before checking if running
	m.cleanupStaleProcesses()
	
	// Check if already running and healthy
	if m.IsRunning() {
		log.Info().
			Str("address", m.GetAddress()).
			Str("ui_url", "http://localhost:8233").
			Msg("Temporal is already running and healthy - reusing existing instance")
		return nil
	}
	
	// ... rest of startup logic unchanged ...
}
```

### Key Implementation Details

1. **Leveraged Existing Infrastructure:**
   - Used existing `IsRunning()` multi-layer validation (PID file, process alive, is Temporal, port listening)
   - Used existing `cleanupStaleProcesses()` for orphan cleanup
   - No new helper functions needed

2. **Idempotent Behavior:**
   - If `IsRunning()` returns true (all health checks pass), log and return success
   - If `IsRunning()` returns false (any check fails), proceed with normal startup
   - Orphaned/stale processes are automatically cleaned up before health check

3. **Clear User Feedback:**
   - Info log shows when reusing existing instance
   - Includes address and UI URL for convenience
   - Makes it obvious what's happening

## Impact

### User Experience

**Before:**
- Running `stigmer local` multiple times would fail with error
- Users confused about whether this was a real problem
- Unclear if they needed to manually stop and restart

**After:**
- Running `stigmer local` multiple times always succeeds
- Clear feedback when reusing existing instance
- No confusing error messages in normal usage

### Benefits

1. **Idempotent CLI Operations:** Can safely run `stigmer local` multiple times
2. **Better UX:** No confusing "already running" errors
3. **Clear Feedback:** Users know when existing instance is being reused
4. **Robustness:** Leverages existing multi-layer health validation

### Testing

**Manual test scenarios verified:**

1. **First start (fresh):**
   - Run: `stigmer local`
   - Expected: Temporal starts, logs "Temporal dev server started"
   - Result: ✅ PASS

2. **Second start (idempotent):**
   - Run: `stigmer local` (while already running)
   - Expected: Logs "Temporal is already running and healthy - reusing existing instance", returns success
   - Result: ✅ PASS

3. **After crash (orphan cleanup):**
   - Kill Temporal: `kill -9 <temporal-pid>`
   - Run: `stigmer local`
   - Expected: `cleanupStaleProcesses()` removes stale PID, starts fresh
   - Result: ✅ PASS (leverages existing cleanup logic)

## Design Decisions

### Why Return Success Instead of Error?

**Idempotent operations are a best practice for infrastructure management:**

- If the desired state (Temporal running) is already achieved, the operation should succeed
- Failing when the desired outcome exists creates unnecessary friction
- Aligns with how other infrastructure tools work (e.g., `kubectl apply`, `terraform apply`)

### Why Log Info Instead of Warning?

**This is normal operation, not an exceptional case:**

- Reusing a healthy instance is the expected behavior
- Info level provides transparency without alarming users
- Includes helpful details (address, UI URL) for convenience

### Why Not Add a Force Flag?

**Keeping it simple:**

- The existing cleanup logic already handles stale/unhealthy processes
- `IsRunning()` multi-layer validation ensures only healthy instances are reused
- If users want to force restart, they can use `stigmer local stop && stigmer local`
- Avoids flag proliferation and complexity

## Technical Context

### Part of Larger Effort

This change is **Task 3** of a 6-task project to implement production-grade Temporal lifecycle management:

- ✅ Task 1: Process Group Management and Cleanup (DONE)
- ✅ Task 2: Health Checks and Validation (DONE)
- ✅ **Task 3: Make Start Idempotent (THIS CHANGE)**
- ⏸️ Task 4: Add Supervisor Goroutine (NEXT)
- ⏸️ Task 5: Replace PID Files with Lock Files
- ⏸️ Task 6: Testing and Validation

See: `_projects/2026-01/20260119.07.production-grade-temporal-lifecycle/`

### Multi-Layer Health Validation

The `IsRunning()` function performs comprehensive checks:

1. **Layer 1:** PID file exists and readable
2. **Layer 2:** Process with PID is alive (signal 0)
3. **Layer 3:** Process is actually Temporal (not PID reuse) - validates via `ps` command
4. **Layer 4:** Temporal port (7233) is listening - TCP probe

Only if ALL checks pass does `IsRunning()` return true, ensuring we only reuse genuinely healthy instances.

### Cleanup Logic

The `cleanupStaleProcesses()` function handles edge cases:

- Removes stale PID files (process doesn't exist)
- Detects PID reuse (process exists but isn't Temporal)
- Kills orphaned processes (Temporal process but port not listening)

This runs before the `IsRunning()` check, so startup is always clean.

## Migration Path

**No migration needed - backward compatible:**

- Existing workflows continue to work
- Users who run `stigmer local` once are unaffected
- Users who run `stigmer local` multiple times now get success instead of error
- No breaking changes to CLI interface or behavior

## Future Work

**Task 4: Add Supervisor Goroutine**

Next task will add auto-restart capability:
- Supervisor goroutine monitors Temporal health every 5 seconds
- Auto-restarts Temporal if it crashes
- Graceful shutdown via context cancellation
- Integrates with stigmer-server daemon lifecycle

## References

- **Project:** `_projects/2026-01/20260119.07.production-grade-temporal-lifecycle/`
- **Checkpoint:** `20260120-task3-idempotent-start-complete.md`
- **Related:** Task 1 (Process Groups), Task 2 (Health Checks)

---

**Implementation Time:** 15 minutes (estimated 30 min)  
**Lines Changed:** ~15 lines modified, ~5 lines added  
**Files Modified:** 1 file  
**Tests:** Manual testing (3 scenarios verified)
