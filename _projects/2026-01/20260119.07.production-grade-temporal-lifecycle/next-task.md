# Next Task: Production-Grade Temporal Lifecycle

**Project:** `_projects/2026-01/20260119.07.production-grade-temporal-lifecycle`  
**Last Updated:** 2026-01-20  
**Current Status:** 🚧 In Progress (4/6 tasks complete)  
**Note:** Supervisor goroutine complete (checkpoint: task4-testing-guide.md)

---

## Quick Context

Implementing production-grade subprocess lifecycle management for Temporal dev server to eliminate "Temporal is already running" errors.

**Problem:** Temporal can crash, leave orphaned processes, have PID reused, and not get properly cleaned up by `stigmer local stop`.

**Solution:** Process groups, health checks, lock files, supervisor pattern, and idempotent start.

**Progress:**
- ✅ Task 1: Process Group Management and Cleanup (DONE)
- ✅ Task 2: Health Checks and Validation (DONE)
- ✅ Task 3: Make Start Idempotent (DONE)
- ✅ Task 4: Add Supervisor Goroutine (DONE)
- ⏸️ Task 5: Replace PID Files with Lock Files (NEXT)

---

## 📋 Next Task: Task 5 - Replace PID Files with Lock Files

**Status:** ⏸️ TODO  
**Estimated:** 45 minutes

### What to Do

1. **Create lock file using syscall.Flock:**
   - Lock file: `~/.stigmer/temporal.lock`
   - Use `LOCK_EX | LOCK_NB` for exclusive non-blocking lock
   - Lock held for lifetime of Temporal process
   - Automatically released on process death

2. **Implement lock file management:**
   - Acquire lock before starting Temporal
   - Release lock when stopping (automatic on file close)
   - Handle lock acquisition failures gracefully
   - Keep PID file for backward compatibility/debugging

3. **Use lock as source of truth:**
   - Check lock availability instead of PID file for "already running"
   - Lock prevents concurrent Temporal instances
   - More reliable than PID-based detection

4. **Test lock behavior:**
   - Verify lock prevents second instance
   - Simulate crash and verify lock is released
   - Verify clean restart after crash
   - Check graceful shutdown releases lock

### Files to Modify
- `client-apps/cli/internal/cli/temporal/manager.go`

### Acceptance Criteria
- [ ] Lock file prevents concurrent Temporal instances
- [ ] Lock automatically released on crash (no manual cleanup needed)
- [ ] Attempting to start second instance fails gracefully with clear message
- [ ] PID file still written for debugging purposes
- [ ] Lock-based detection more reliable than PID-based

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
"Let's continue with Task 4: Add Supervisor Goroutine"
```

---

**Drag this file into chat to instantly resume!**
