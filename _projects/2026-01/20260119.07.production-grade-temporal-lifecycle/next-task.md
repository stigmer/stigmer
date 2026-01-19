# Next Task: Production-Grade Temporal Lifecycle

**Project:** `_projects/2026-01/20260119.07.production-grade-temporal-lifecycle`  
**Last Updated:** 2026-01-20  
**Current Status:** 🚧 In Progress (5/6 tasks complete)  
**Note:** Lock file implementation complete (checkpoint: task5-testing-guide.md)

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
- ✅ Task 5: Replace PID Files with Lock Files (DONE)
- ⏸️ Task 6: Testing and Validation (NEXT)

---

## 📋 Next Task: Task 6 - Testing and Validation

**Status:** ⏸️ TODO  
**Estimated:** 30 minutes

### What to Do

1. **Test normal lifecycle:**
   - Start → Stop → Start cycle
   - Verify clean startup and shutdown
   - Check logs for proper sequencing

2. **Test crash recovery:**
   - Kill Temporal with `kill -9`
   - Verify supervisor auto-restarts (within 5s)
   - Verify lock auto-released and reacquired

3. **Test idempotency:**
   - Run `stigmer local` multiple times
   - Verify "already running" detection works
   - Verify lock-based fast path

4. **Test concurrent access:**
   - Try starting two instances simultaneously
   - Verify lock prevents second instance
   - Verify first instance continues normally

5. **Test orphan cleanup:**
   - Kill with `kill -9`, then start again
   - Verify stale PID file cleaned
   - Verify lock auto-released

6. **Test health checks:**
   - Verify health checks run every 5s
   - Verify detect failures correctly
   - Verify integrate with lock file

### Test Scenarios

1. **Normal flow**: `stigmer local` → `stigmer local stop` → `stigmer local`
2. **Restart**: `stigmer local restart`
3. **Crash recovery**: `kill -9 <pid>` → wait 5s → verify auto-restart
4. **Orphan cleanup**: `kill -9 <pid>` → `stigmer local stop` → `stigmer local`
5. **Concurrent start**: Two terminals run `stigmer local` simultaneously
6. **Idempotent start**: `stigmer local` when already running

### Acceptance Criteria
- [ ] All 6 test scenarios pass
- [ ] No "already running" errors in normal usage
- [ ] Auto-restart works reliably after crash
- [ ] Lock prevents concurrent instances
- [ ] Clear, helpful log messages for all scenarios
- [ ] No stale locks or PID files after testing

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
