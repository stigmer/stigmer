# Next Task: Production-Grade Temporal Lifecycle

**Project:** `_projects/2026-01/20260119.07.production-grade-temporal-lifecycle`  
**Last Updated:** 2026-01-19  
**Current Status:** 🚧 In Progress (2/6 tasks complete)  
**Note:** Health checks and validation complete (checkpoint: 20260119-task2-health-checks-complete.md)

---

## Quick Context

Implementing production-grade subprocess lifecycle management for Temporal dev server to eliminate "Temporal is already running" errors.

**Problem:** Temporal can crash, leave orphaned processes, have PID reused, and not get properly cleaned up by `stigmer local stop`.

**Solution:** Process groups, health checks, lock files, supervisor pattern, and idempotent start.

**Progress:**
- ✅ Task 1: Process Group Management and Cleanup (DONE)
- ✅ Task 2: Health Checks and Validation (DONE)
- ⏸️ Task 3: Make Start Idempotent (NEXT)

---

## 📋 Next Task: Task 3 - Make Start Idempotent

**Status:** ⏸️ TODO  
**Estimated:** 30 min

### What to Do

1. **Refactor `Start()` to be idempotent:**
   - Check if Temporal is already running via `IsRunning()`
   - If running AND healthy → log success message and return (reuse existing)
   - If not running OR unhealthy → cleanup and start fresh

2. **Add clear logging:**
   - Log when reusing existing healthy Temporal
   - Log when cleaning up and starting fresh
   - Make it obvious to users what's happening

3. **Remove "already running" error:**
   - Current code: `return errors.New("Temporal is already running")`
   - New behavior: log and return success (idempotent)

4. **Test idempotency:**
   - Run `stigmer local` twice in a row
   - First: should start Temporal
   - Second: should detect running instance, log reuse, return success
   - Both commands should succeed

### Files to Modify
- `client-apps/cli/internal/cli/temporal/manager.go`

### Acceptance Criteria
- [ ] Running `stigmer local` twice succeeds both times
- [ ] Second invocation detects and reuses healthy Temporal
- [ ] Clear logging shows whether reusing or starting fresh
- [ ] No "already running" errors in normal usage

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
