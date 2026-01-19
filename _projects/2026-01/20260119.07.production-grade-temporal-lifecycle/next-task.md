# Next Task: Production-Grade Temporal Lifecycle

**Project:** `_projects/2026-01/20260119.07.production-grade-temporal-lifecycle`  
**Last Updated:** 2026-01-19  
**Current Status:** 🚧 In Progress (1/6 tasks complete)  
**Note:** Test suite fixed and stable (checkpoint: 20260119-test-fixes-complete.md)

---

## Quick Context

Implementing production-grade subprocess lifecycle management for Temporal dev server to eliminate "Temporal is already running" errors.

**Problem:** Temporal can crash, leave orphaned processes, have PID reused, and not get properly cleaned up by `stigmer local stop`.

**Solution:** Process groups, health checks, lock files, supervisor pattern, and idempotent start.

**Progress:**
- ✅ Task 1: Process Group Management and Cleanup (DONE)
- ⏸️ Task 2: Health Checks and Validation (NEXT)

---

## 📋 Next Task: Task 2 - Implement Health Checks and Validation

**Status:** ⏸️ TODO  
**Estimated:** 45 min

### What to Do

1. **Enhance PID file format:**
   - Change PID file to include: PID, command name, start timestamp
   - Format: `<pid>\n<cmdname>\n<timestamp>`
   - Update `writePIDFile()` and `getPID()` to handle new format

2. **Implement `isActuallyTemporal()` function:**
   - Check process command line contains "temporal"
   - Verify executable path matches expected Temporal binary
   - Return true only if it's genuinely Temporal

3. **Improve `IsRunning()` with multi-layer validation:**
   - Check 1: Process exists (current check)
   - Check 2: Process is actually Temporal (via `isActuallyTemporal()`)
   - Check 3: Temporal port (7233) is listening
   - All three must pass for `IsRunning()` to return true

4. **Update `cleanupStaleProcesses()`:**
   - Use enhanced validation to detect stale/invalid processes
   - Remove PID files for non-Temporal processes (PID reuse case)

5. **Test:**
   - Build: `make build`
   - Start Temporal, verify enhanced PID file format
   - Kill Temporal, start unrelated process with same PID (simulated)
   - Verify `IsRunning()` correctly identifies it's not Temporal

### Files to Modify
- `client-apps/cli/internal/cli/temporal/manager.go`

### Acceptance Criteria
- [ ] PID file includes process metadata (PID, name, timestamp)
- [ ] `IsRunning()` validates process is actually Temporal, not PID reuse
- [ ] Health check combines TCP probe + process validation
- [ ] Stale/invalid PID files are automatically cleaned

---

## 📚 Quick Links

- **Full Project:** [README.md](_projects/2026-01/20260119.07.production-grade-temporal-lifecycle/README.md)
- **All Tasks:** [tasks.md](_projects/2026-01/20260119.07.production-grade-temporal-lifecycle/tasks.md)
- **Notes:** [notes.md](_projects/2026-01/20260119.07.production-grade-temporal-lifecycle/notes.md)

---

## 🚀 Resume Commands

```bash
# Read current task details
@_projects/2026-01/20260119.07.production-grade-temporal-lifecycle/tasks.md

# See full project context
@_projects/2026-01/20260119.07.production-grade-temporal-lifecycle/README.md

# Continue working
"Let's continue with Task 2: Implement Health Checks and Validation"
```

---

**Drag this file into chat to instantly resume!**
