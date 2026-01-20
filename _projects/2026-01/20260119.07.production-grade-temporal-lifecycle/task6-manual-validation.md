# Task 6 Manual Validation Checklist

## Overview
Manual validation checklist for all production-grade Temporal lifecycle features.
Since you've already tested these features manually, use this checklist to document and verify completion.

## Prerequisites
- ✅ Build CLI: `cd client-apps/cli && go build -o /tmp/stigmer-cli main.go`
- ✅ Ensure clean state before each test

## Validation Checklist

### ✅ Test 1: Normal Lifecycle (Start → Stop → Start)

**Steps:**
1. Run `stigmer local`
2. Verify Temporal starts and is accessible
3. Run `stigmer local stop`
4. Verify Temporal stops cleanly
5. Run `stigmer local` again
6. Verify restart succeeds

**Validation Points:**
- [ ] Clean startup with no errors
- [ ] Lock file created at `~/.stigmer/temporal.lock`
- [ ] PID file created at `~/.stigmer/temporal.pid`
- [ ] Graceful shutdown kills all processes
- [ ] Lock released after stop
- [ ] Restart succeeds without manual cleanup

**Expected Behavior:**
- Process group created (all children killed on stop)
- Clear log messages for each phase
- No stale files after stop

---

### ✅ Test 2: Idempotent Start (Already Running)

**Steps:**
1. Run `stigmer local`
2. While running, run `stigmer local` again
3. Observe behavior and logs

**Validation Points:**
- [ ] Second start succeeds (no error)
- [ ] Log message: "Temporal is already running (lock file held) - reusing existing instance"
- [ ] Only one Temporal process running
- [ ] Fast execution (lock-based fast path)
- [ ] First instance continues normally

**Expected Behavior:**
- Lock file prevents duplicate instances
- Idempotent behavior (command succeeds both times)
- No unnecessary work on second start

---

### ✅ Test 3: Crash Recovery with Auto-Restart

**Steps:**
1. Run `stigmer local`
2. Get Temporal PID: `cat ~/.stigmer/temporal.pid | head -1`
3. Kill Temporal: `kill -9 <pid>`
4. Wait 7 seconds and check if auto-restarted
5. Verify new process running with different PID

**Validation Points:**
- [ ] Supervisor detects crash within 5 seconds
- [ ] Auto-restart triggered automatically
- [ ] New Temporal process started
- [ ] Lock reacquired by new process
- [ ] Logs show: "Temporal health check failed" → "Attempting to restart" → "Restarted successfully"
- [ ] No manual intervention required

**Expected Behavior:**
- Health check interval: 5 seconds
- Detection + restart: < 7 seconds total
- Clean restart with new PID
- Lock handling works correctly

---

### ✅ Test 4: Orphan Cleanup

**Steps:**
1. Run `stigmer local`
2. Kill Temporal: `kill -9 <pid>`
3. Immediately run `stigmer local stop` (before supervisor restarts)
4. Run `stigmer local` again
5. Verify clean start

**Validation Points:**
- [ ] Stale PID file detected and removed
- [ ] Lock released (automatically by OS on crash)
- [ ] Fresh start succeeds without errors
- [ ] No orphaned processes remaining
- [ ] Cleanup logic handles stale state correctly

**Expected Behavior:**
- `cleanupStaleProcesses()` removes stale files
- Multi-layer validation prevents PID reuse issues
- Clean recovery without manual intervention

---

### ✅ Test 5: Lock File Prevents Concurrent Instances

**Steps:**
1. Open two terminal windows
2. Terminal 1: Run `stigmer local`
3. Terminal 2: Run `stigmer local`
4. Check process count: `ps aux | grep "temporal server" | grep -v grep`

**Validation Points:**
- [ ] First instance starts successfully
- [ ] Second instance detects lock and returns success (idempotent)
- [ ] Only one Temporal process running
- [ ] Both commands succeed (exit code 0)
- [ ] Lock file held throughout

**Expected Behavior:**
- Lock prevents race conditions
- Atomic lock acquisition via `syscall.Flock`
- Clear messaging about reusing existing instance

---

### ✅ Test 6: Process Group Cleanup

**Steps:**
1. Run `stigmer local`
2. Get process tree: `pstree -p <temporal-pid>` or `ps -g <temporal-pid>`
3. Run `stigmer local stop`
4. Verify all child processes terminated

**Validation Points:**
- [ ] Process group created on start (PID == PGID)
- [ ] SIGTERM sent to entire process group on stop
- [ ] All child processes terminated
- [ ] No orphaned Temporal processes
- [ ] Clean shutdown within timeout (< 10 seconds)

**Expected Behavior:**
- `Setpgid: true` creates process group
- `syscall.Kill(-pid, SIGTERM)` kills entire group
- Graceful shutdown attempted first
- Force kill (`SIGKILL`) if needed after timeout

---

### ✅ Test 7: Health Checks Running

**Steps:**
1. Run `stigmer local` with debug logging enabled
2. Monitor logs for health check messages
3. Verify health checks run every 5 seconds

**Validation Points:**
- [ ] Debug logs show: "Temporal health check passed" every 5 seconds
- [ ] Multi-layer validation working:
  - Lock file check
  - PID file exists
  - Process alive
  - Process is actually Temporal
  - Port 7233 listening
- [ ] Health check detects failures correctly

**Expected Behavior:**
- Supervisor goroutine runs continuously
- Health check interval: 5 seconds (configurable)
- All validation layers functioning

---

### ✅ Test 8: Lock Auto-Release on Crash

**Steps:**
1. Run `stigmer local`
2. Verify lock held: `lsof ~/.stigmer/temporal.lock`
3. Kill Temporal: `kill -9 <pid>`
4. Immediately check lock: `lsof ~/.stigmer/temporal.lock`
5. Run `stigmer local stop` to prevent supervisor restart
6. Verify lock released

**Validation Points:**
- [ ] Lock held before crash
- [ ] Lock auto-released by OS after crash
- [ ] No stale locks preventing restart
- [ ] Lock-based detection more reliable than PID-based

**Expected Behavior:**
- OS releases flock when process dies
- No manual cleanup needed
- Atomic lock handling prevents races

---

### ✅ Test 9: Supervisor Graceful Shutdown

**Steps:**
1. Run `stigmer local` with debug logging
2. Run `stigmer local stop`
3. Monitor logs for supervisor shutdown sequence

**Validation Points:**
- [ ] Logs show: "Stopping Temporal supervisor"
- [ ] Logs show: "Supervisor context cancelled, stopping"
- [ ] No restart attempts during shutdown
- [ ] Clean goroutine shutdown (no leaks)
- [ ] Temporal stops cleanly after supervisor stops

**Expected Behavior:**
- Supervisor stopped before Temporal shutdown
- Context cancellation prevents restart attempts
- Clean shutdown sequence

---

### ✅ Test 10: Multi-Cycle Stress Test

**Steps:**
1. Run 3-5 crash/recovery cycles:
   - Start → Crash (`kill -9`) → Wait for auto-restart → Verify
2. Observe stability and logs

**Validation Points:**
- [ ] All cycles complete successfully
- [ ] Each recovery happens within 7 seconds
- [ ] No lock file issues or stale state accumulation
- [ ] No performance degradation over cycles
- [ ] System remains stable throughout

**Expected Behavior:**
- Consistent recovery behavior
- No memory leaks or resource issues
- Clean state management across cycles

---

## Summary Validation

After completing all tests, verify:

### Core Functionality
- [ ] ✅ Start works reliably
- [ ] ✅ Stop terminates all processes cleanly
- [ ] ✅ Restart works smoothly
- [ ] ✅ Lock prevents concurrent instances

### Crash Recovery
- [ ] ✅ Auto-restart works after `kill -9`
- [ ] ✅ Recovery happens within 5-7 seconds
- [ ] ✅ Lock auto-released and reacquired
- [ ] ✅ Orphaned processes cleaned up

### Idempotency
- [ ] ✅ Running `stigmer local` when already running succeeds
- [ ] ✅ Clear "already running" message logged
- [ ] ✅ No duplicate processes created
- [ ] ✅ Fast lock-based detection

### Health & Monitoring
- [ ] ✅ Health checks run every 5 seconds
- [ ] ✅ Failures detected correctly
- [ ] ✅ Multi-layer validation working
- [ ] ✅ Clear log messages

### Process Management
- [ ] ✅ Process groups working correctly
- [ ] ✅ All children killed on stop
- [ ] ✅ No orphaned processes

### Supervisor
- [ ] ✅ Auto-restart on failure
- [ ] ✅ Graceful shutdown
- [ ] ✅ No restarts during shutdown

---

## Acceptance Criteria - Final Checklist

**All must be checked to mark Task 6 complete:**

- [ ] All 10 manual tests completed and validated
- [ ] No "already running" errors in normal usage
- [ ] Auto-restart works reliably (< 7 seconds)
- [ ] Lock prevents concurrent instances
- [ ] Clear, helpful log messages for all scenarios
- [ ] No stale locks or PID files after testing
- [ ] Process groups clean up all children
- [ ] Supervisor works correctly (monitoring + auto-restart + graceful shutdown)
- [ ] Multi-layer validation prevents PID reuse issues
- [ ] System stable through multiple crash/recovery cycles

---

## Performance Metrics (Optional)

Track these if measuring performance:

| Metric | Target | Actual |
|--------|--------|--------|
| Startup time (cold) | < 5s | ___ |
| Startup time (idempotent) | < 100ms | ___ |
| Crash detection | ~5s | ___ |
| Auto-restart total | < 7s | ___ |
| Shutdown time | < 3s | ___ |

---

## Implementation Summary

This validates the complete implementation of all 5 tasks:

1. **Process Groups (Task 1)**: ✅ `Setpgid: true`, process group killing
2. **Health Checks (Task 2)**: ✅ Multi-layer validation (lock + PID + process + port)
3. **Idempotent Start (Task 3)**: ✅ Lock-based fast path, reuse existing
4. **Supervisor (Task 4)**: ✅ Auto-restart goroutine, graceful shutdown
5. **Lock Files (Task 5)**: ✅ `flock` atomic locks, auto-release

---

## Next Steps After Validation

Once all tests pass:

1. ✅ Mark Task 6 complete in `tasks.md`
2. ✅ Update `next-task.md` to reflect completion
3. ✅ Create completion checkpoint: `20260120-task6-validation-complete.md`
4. ✅ Update project README with final status
5. 🎉 **Production-grade Temporal lifecycle is COMPLETE!**

---

## Notes

- Since you've already manually tested these features, this checklist serves as documentation
- Feel free to check off items you've already validated
- Any issues discovered should be noted and fixed before marking complete
- This comprehensive validation ensures production readiness
