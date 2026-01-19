# Next Task: Production-Grade Temporal Lifecycle

**Project:** `_projects/2026-01/20260119.07.production-grade-temporal-lifecycle`  
**Last Updated:** 2026-01-20  
**Current Status:** 🚧 In Progress (3/6 tasks complete)  
**Note:** Idempotent start complete (checkpoint: 20260120-task3-idempotent-start-complete.md)

---

## Quick Context

Implementing production-grade subprocess lifecycle management for Temporal dev server to eliminate "Temporal is already running" errors.

**Problem:** Temporal can crash, leave orphaned processes, have PID reused, and not get properly cleaned up by `stigmer local stop`.

**Solution:** Process groups, health checks, lock files, supervisor pattern, and idempotent start.

**Progress:**
- ✅ Task 1: Process Group Management and Cleanup (DONE)
- ✅ Task 2: Health Checks and Validation (DONE)
- ✅ Task 3: Make Start Idempotent (DONE)
- ⏸️ Task 4: Add Supervisor Goroutine (NEXT)

---

## 📋 Next Task: Task 4 - Add Supervisor Goroutine

**Status:** ⏸️ TODO  
**Estimated:** 1 hour

### What to Do

1. **Create Supervisor struct:**
   - Manages Temporal lifecycle with health monitoring
   - Holds reference to Manager, context for cancellation, health check interval
   - Implements auto-restart on failure

2. **Launch supervisor goroutine:**
   - Checks Temporal health every 5 seconds
   - Auto-restarts Temporal if health check fails
   - Graceful degradation: log errors but don't crash stigmer-server
   - Context-based cancellation for clean shutdown

3. **Integrate with daemon:**
   - Start supervisor when stigmer-server starts
   - Stop supervisor gracefully when daemon stops
   - Ensure no goroutine leaks

4. **Test crash recovery:**
   - Simulate crash with `kill -9 <temporal-pid>`
   - Verify supervisor detects failure within 5 seconds
   - Verify Temporal auto-restarts successfully
   - Check logs for clear restart event messages

### Files to Create/Modify
- `client-apps/cli/internal/cli/temporal/supervisor.go` (new file)
- `client-apps/cli/internal/cli/temporal/manager.go` (add Supervisor integration)
- `client-apps/cli/internal/cli/daemon/daemon.go` (integrate supervisor)

### Acceptance Criteria
- [ ] Supervisor goroutine starts with Temporal
- [ ] Temporal auto-restarts after simulated crash (`kill -9`)
- [ ] Health check interval is 5 seconds
- [ ] Graceful shutdown: supervisor stops when daemon stops
- [ ] Clear logging for restart events
- [ ] No goroutine leaks

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
