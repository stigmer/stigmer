# Task 6 Testing Guide: Integration Testing and Validation

## Overview
This guide validates all production-grade Temporal lifecycle features working together:
- Process group management and cleanup (Task 1)
- Health checks and validation (Task 2)
- Idempotent start (Task 3)
- Supervisor auto-restart (Task 4)
- Lock file concurrency control (Task 5)

## Prerequisites
- Build the CLI: `cd client-apps/cli && go build -o /tmp/stigmer-cli ./cmd/stigmer`
- Ensure no existing Stigmer processes running: `/tmp/stigmer-cli local stop`
- Clean state: `rm -f ~/.stigmer/temporal.lock ~/.stigmer/temporal.pid`
- Clean logs (optional): `rm -f ~/.stigmer/logs/daemon.log ~/.stigmer/logs/temporal.log`

## Test 1: Normal Lifecycle (Start → Stop → Start)

**Objective:** Verify clean startup, shutdown, and restart cycle

```bash
# Clean start
/tmp/stigmer-cli local

# Verify running
ps aux | grep temporal | grep -v grep
lsof ~/.stigmer/temporal.lock

# Check logs show healthy state
tail -20 ~/.stigmer/logs/daemon.log

# Stop gracefully
/tmp/stigmer-cli local stop

# Verify stopped
ps aux | grep temporal | grep -v grep  # Should be empty
lsof ~/.stigmer/temporal.lock  # Should be empty

# Restart
/tmp/stigmer-cli local
```

**Expected:**
- ✅ First start succeeds, Temporal process running
- ✅ Lock file held during operation
- ✅ Stop kills all processes cleanly (process group)
- ✅ Lock released after stop
- ✅ Restart succeeds without errors
- ✅ Clear log messages for each phase

## Test 2: Restart Command

**Objective:** Verify restart command works smoothly

```bash
# Start
/tmp/stigmer-cli local

# Get PID before restart
pid_before=$(cat ~/.stigmer/temporal.pid | head -1)
echo "PID before: $pid_before"

# Restart
/tmp/stigmer-cli local restart

# Get PID after restart
pid_after=$(cat ~/.stigmer/temporal.pid | head -1)
echo "PID after: $pid_after"

# Verify new process
ps aux | grep temporal | grep -v grep
```

**Expected:**
- ✅ Restart command succeeds
- ✅ Old process terminated gracefully
- ✅ New process started with different PID
- ✅ No errors or warnings in logs
- ✅ Temporal UI accessible at http://localhost:8233

## Test 3: Crash Recovery with Auto-Restart

**Objective:** Verify supervisor detects crash and auto-restarts within 5 seconds

```bash
# Terminal 1: Start and watch logs
/tmp/stigmer-cli local
tail -f ~/.stigmer/logs/daemon.log

# Terminal 2: Simulate crash
temporal_pid=$(cat ~/.stigmer/temporal.pid | head -1)
echo "Killing Temporal PID: $temporal_pid"
kill -9 $temporal_pid

# Wait and observe Terminal 1 logs
# Should see:
# - "Temporal health check failed"
# - "Attempting to restart Temporal"
# - "Temporal restarted successfully"

# Terminal 2: Verify auto-restart happened
sleep 7  # Wait for health check (5s) + restart (1s backoff)
ps aux | grep temporal | grep -v grep
new_pid=$(cat ~/.stigmer/temporal.pid | head -1)
echo "New PID: $new_pid (should be different from $temporal_pid)"
```

**Expected:**
- ✅ Supervisor detects crash within 5 seconds (health check interval)
- ✅ Auto-restart succeeds automatically
- ✅ New Temporal process running with different PID
- ✅ Lock automatically reacquired by new process
- ✅ Clear log messages showing restart sequence
- ✅ No manual intervention required

## Test 4: Orphan Cleanup and Recovery

**Objective:** Verify stale processes cleaned up before starting fresh

```bash
# Start Temporal
/tmp/stigmer-cli local

# Force kill to create orphan
temporal_pid=$(cat ~/.stigmer/temporal.pid | head -1)
kill -9 $temporal_pid

# Immediately stop (before supervisor restarts)
sleep 1
/tmp/stigmer-cli local stop

# Verify cleanup
ps aux | grep temporal | grep -v grep  # Should be empty
lsof ~/.stigmer/temporal.lock  # Should be empty

# Start fresh
/tmp/stigmer-cli local

# Verify healthy start
ps aux | grep temporal | grep -v grep
cat ~/.stigmer/temporal.pid
```

**Expected:**
- ✅ Stale PID file detected and cleaned
- ✅ Lock released (automatically by OS)
- ✅ Fresh start succeeds without errors
- ✅ No orphaned processes remaining
- ✅ New process is healthy and responding

## Test 5: Concurrent Start Attempts

**Objective:** Verify lock prevents duplicate instances, idempotent behavior works

```bash
# Terminal 1: Start Stigmer
/tmp/stigmer-cli local

# Terminal 2: Try to start again (should be idempotent)
/tmp/stigmer-cli local

# Terminal 2: Check logs
tail -20 ~/.stigmer/logs/daemon.log | grep -i "already running"

# Terminal 2: Verify only one Temporal process
ps aux | grep temporal | grep -v grep | wc -l  # Should be 1
```

**Expected:**
- ✅ First instance starts successfully
- ✅ Second instance detects lock immediately (fast path)
- ✅ Log message: "Temporal is already running (lock file held) - reusing existing instance"
- ✅ Second command succeeds (returns 0, no error)
- ✅ Only one Temporal process running
- ✅ First instance continues normally

## Test 6: Idempotent Start (Already Running)

**Objective:** Verify running `stigmer local` when already running succeeds gracefully

```bash
# Start Temporal
/tmp/stigmer-cli local

# Run start command 3 times in a row
for i in {1..3}; do
  echo "=== Attempt $i ==="
  /tmp/stigmer-cli local
  echo "Exit code: $?"
  sleep 1
done

# Verify only one process running
ps aux | grep temporal | grep -v grep | wc -l
```

**Expected:**
- ✅ All 3 start attempts succeed (exit code 0)
- ✅ Each shows: "Temporal is already running (lock file held) - reusing existing instance"
- ✅ Only one Temporal process running throughout
- ✅ No errors or warnings
- ✅ Performance is fast (lock check is instant)

## Test 7: Health Check Validation

**Objective:** Verify health checks run every 5 seconds and detect failures correctly

```bash
# Terminal 1: Start and watch debug logs
STIGMER_LOG_LEVEL=debug /tmp/stigmer-cli local
tail -f ~/.stigmer/logs/daemon.log | grep -i "health check"

# Terminal 2: Observe health check logs
# Should see debug messages every 5 seconds:
# - "Temporal health check passed"

# Terminal 2: Simulate failure
temporal_pid=$(cat ~/.stigmer/temporal.pid | head -1)
kill -9 $temporal_pid

# Observe Terminal 1 - should see within 5 seconds:
# - "Temporal health check failed - process not running or unhealthy"
# - "Attempting to restart Temporal..."
# - "Temporal restarted successfully"
```

**Expected:**
- ✅ Health checks run every 5 seconds (visible in debug logs)
- ✅ Successful checks log "health check passed"
- ✅ Failed check detected within 5 seconds of crash
- ✅ Restart triggered automatically
- ✅ Multi-layer validation working (lock + PID + process + port)

## Test 8: Process Group Cleanup

**Objective:** Verify all child processes killed on stop

```bash
# Start Temporal
/tmp/stigmer-cli local

# Get process tree
temporal_pid=$(cat ~/.stigmer/temporal.pid | head -1)
echo "Temporal process tree:"
pstree -p $temporal_pid 2>/dev/null || ps -g $temporal_pid

# Stop
/tmp/stigmer-cli local stop

# Verify all processes gone
ps -g $temporal_pid 2>/dev/null | grep -v grep
# Should be empty or "no such process"
```

**Expected:**
- ✅ Process group created (PID == PGID)
- ✅ Stop sends SIGTERM to entire process group
- ✅ All child processes terminated
- ✅ No orphaned Temporal processes
- ✅ Clean shutdown within timeout

## Test 9: Supervisor Shutdown

**Objective:** Verify supervisor stops gracefully and doesn't restart during shutdown

```bash
# Terminal 1: Start with debug logs
STIGMER_LOG_LEVEL=debug /tmp/stigmer-cli local
tail -f ~/.stigmer/logs/daemon.log

# Terminal 2: Initiate stop
/tmp/stigmer-cli local stop

# Observe Terminal 1 logs - should see:
# - "Stopping Temporal supervisor"
# - "Supervisor context cancelled, stopping"
# - Sent SIGTERM to Temporal process group"
# - "Temporal stopped successfully"

# Verify no restart attempts during shutdown
# Should NOT see "Attempting to restart Temporal" after stop initiated
```

**Expected:**
- ✅ Supervisor stopped before Temporal shutdown begins
- ✅ Context cancellation prevents restart attempts
- ✅ Clean supervisor goroutine shutdown
- ✅ No goroutine leaks
- ✅ Temporal stops without supervisor interference

## Test 10: End-to-End Stress Test

**Objective:** Verify system stability through multiple crash/restart cycles

```bash
# Run 5 crash/recovery cycles
for i in {1..5}; do
  echo "=== Crash/Recovery Cycle $i ==="
  
  # Start if not running
  /tmp/stigmer-cli local
  
  # Wait for healthy state
  sleep 3
  
  # Crash
  temporal_pid=$(cat ~/.stigmer/temporal.pid | head -1)
  echo "Killing PID: $temporal_pid"
  kill -9 $temporal_pid
  
  # Wait for auto-restart
  sleep 7
  
  # Verify recovered
  new_pid=$(cat ~/.stigmer/temporal.pid | head -1)
  if ps -p $new_pid > /dev/null; then
    echo "✅ Cycle $i: Recovered (new PID: $new_pid)"
  else
    echo "❌ Cycle $i: Failed to recover"
    exit 1
  fi
done

echo "=== All cycles passed ==="
/tmp/stigmer-cli local stop
```

**Expected:**
- ✅ All 5 cycles complete successfully
- ✅ Each crash detected and recovered within 7 seconds
- ✅ No lock file issues or stale state
- ✅ No accumulated errors or degradation
- ✅ System remains stable throughout

## Verification Checklist

After running all tests, verify:

### Basic Functionality
- [ ] Start command succeeds and Temporal runs
- [ ] Stop command terminates all processes
- [ ] Restart command works smoothly
- [ ] Lock file prevents concurrent instances

### Crash Recovery
- [ ] Auto-restart works after kill -9
- [ ] Recovery happens within 5-7 seconds
- [ ] Lock automatically reacquired after crash
- [ ] Orphaned processes cleaned up

### Idempotency
- [ ] Running `stigmer local` when already running succeeds
- [ ] "Already running" message logged clearly
- [ ] No duplicate processes created
- [ ] Performance is fast (lock-based fast path)

### Health Checks
- [ ] Health checks run every 5 seconds
- [ ] Failures detected correctly
- [ ] Multi-layer validation working
- [ ] Logs show health check status

### Process Groups
- [ ] Process group created on start
- [ ] All child processes killed on stop
- [ ] No orphaned processes after stop

### Supervisor
- [ ] Supervisor starts with Temporal
- [ ] Auto-restart triggered on failure
- [ ] Supervisor stops gracefully on shutdown
- [ ] No restarts during shutdown sequence

### Logs and Messages
- [ ] Clear success messages
- [ ] Helpful error messages
- [ ] Debug logs available for troubleshooting
- [ ] No confusing or misleading messages

## Troubleshooting

### Supervisor Not Restarting
- Check: Logs show "Temporal health check failed"
- Verify: Health check interval is 5 seconds (check supervisor.go)
- Check: Supervisor started in daemon.go
- Debug: Set `STIGMER_LOG_LEVEL=debug` to see health checks

### Auto-Restart Too Slow
- Expected: 5 seconds (health check) + 1 second (backoff) = ~6-7 seconds total
- Check: Supervisor goroutine running (`ps` and `lsof` on lock file)
- Verify: No errors in restart attempt logs

### Health Checks Not Running
- Check: Supervisor started after Temporal starts
- Verify: Goroutine spawned in `supervisor.Start()`
- Debug: Look for "Starting Temporal supervisor" log message

### Processes Not Cleaned Up
- Check: Process group created (`ps -o pgid= -p $pid`)
- Verify: Stop uses `syscall.Kill(-pid, SIGTERM)`
- Check: Timeout sufficient for graceful shutdown

### Lock File Issues
- Check: Lock file exists and permissions OK
- Verify: `lsof ~/.stigmer/temporal.lock` shows process holding lock
- Debug: Check `acquireLock()` and `releaseLock()` calls

## Success Criteria

**All tests must pass:**
- ✅ Tests 1-10 complete with expected results
- ✅ All checklist items verified
- ✅ No stale locks or PID files after testing
- ✅ Clear, helpful log messages for all scenarios
- ✅ Auto-restart works reliably (< 7 seconds)
- ✅ No "already running" errors in normal usage

## Performance Benchmarks

Track these metrics during testing:

| Metric | Target | Actual |
|--------|--------|--------|
| Startup time (cold start) | < 5s | ___ |
| Startup time (hot start/idempotent) | < 100ms | ___ |
| Crash detection time | ~5s (health check interval) | ___ |
| Auto-restart time | < 7s (detection + restart) | ___ |
| Shutdown time | < 3s | ___ |

## Implementation Summary

This testing validates the complete implementation:

1. **Process Groups (Task 1)**: Clean child process management
2. **Health Checks (Task 2)**: Multi-layer validation (lock + PID + process + port)
3. **Idempotent Start (Task 3)**: Fast lock-based detection, no duplicate starts
4. **Supervisor (Task 4)**: Auto-restart within 5-7 seconds, graceful shutdown
5. **Lock Files (Task 5)**: Atomic concurrency control, auto-release on crash

## Next Steps

After validation:
1. ✅ Mark Task 6 as complete in tasks.md
2. ✅ Update next-task.md to reflect project completion
3. ✅ Create completion checkpoint document
4. 🎉 Production-grade Temporal lifecycle is complete!
