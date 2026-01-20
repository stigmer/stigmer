# Task 4 Testing Guide: Supervisor Goroutine

## Overview
This guide provides step-by-step instructions to test the Temporal supervisor auto-restart functionality.

## Prerequisites
- Build the CLI: `cd client-apps/cli && go build -o /tmp/stigmer-cli`
- Ensure no existing Stigmer processes are running: `/tmp/stigmer-cli local stop`

## Test 1: Normal Startup with Supervisor

**Objective:** Verify supervisor starts with Temporal

```bash
# Start stigmer local
/tmp/stigmer-cli local

# Check logs to verify supervisor started
tail -f ~/.stigmer/logs/daemon.log | grep -i supervisor
```

**Expected:**
- Log message: "Temporal supervisor started"
- Log message: "Starting Temporal supervisor" with interval=5s

## Test 2: Crash Recovery (Auto-Restart)

**Objective:** Verify Temporal auto-restarts after crash

```bash
# Terminal 1: Start stigmer and keep logs visible
/tmp/stigmer-cli local
tail -f ~/.stigmer/logs/daemon.log

# Terminal 2: Find and kill Temporal process
ps aux | grep temporal
kill -9 <temporal-pid>

# Terminal 1: Watch logs for auto-restart (within 5 seconds)
```

**Expected:**
- Within 5 seconds: "Temporal health check failed - process not running or unhealthy"
- Log message: "Attempting to restart Temporal..."
- Log message: "Temporal restarted successfully"
- Temporal accessible again at localhost:7233

## Test 3: Graceful Shutdown (No Goroutine Leaks)

**Objective:** Verify supervisor stops cleanly

```bash
# Start stigmer
/tmp/stigmer-cli local

# Stop stigmer
/tmp/stigmer-cli local stop

# Check logs for clean shutdown
tail -30 ~/.stigmer/logs/daemon.log | grep -i supervisor
```

**Expected:**
- Log message: "Stopping Temporal supervisor..."
- Log message: "Stopping Temporal supervisor"
- Log message: "Supervisor context cancelled, stopping"
- No error messages about goroutine leaks

## Test 4: Multiple Restarts

**Objective:** Verify supervisor handles repeated failures

```bash
# Terminal 1: Watch logs
tail -f ~/.stigmer/logs/daemon.log

# Terminal 2: Kill Temporal multiple times
for i in {1..3}; do
  sleep 10
  temporal_pid=$(ps aux | grep -v grep | grep temporal | awk '{print $2}' | head -1)
  echo "Killing Temporal (attempt $i): $temporal_pid"
  kill -9 $temporal_pid
done
```

**Expected:**
- 3 auto-restart cycles
- Each cycle shows: health check failed → attempting restart → restarted successfully
- No degradation or failures

## Test 5: Supervisor Prevents Restart During Shutdown

**Objective:** Verify supervisor doesn't restart during stop

```bash
# Terminal 1: Watch logs continuously
tail -f ~/.stigmer/logs/daemon.log

# Terminal 2: Start and immediately stop
/tmp/stigmer-cli local
sleep 2
/tmp/stigmer-cli local stop
```

**Expected:**
- Supervisor stops before Temporal stops
- No "attempting restart" messages during shutdown
- Clean shutdown without errors

## Test 6: Health Check Frequency

**Objective:** Verify health checks run every 5 seconds

```bash
# Start stigmer
/tmp/stigmer-cli local

# Watch debug logs (ensure LOG_LEVEL=DEBUG)
tail -f ~/.stigmer/logs/daemon.log | grep "Temporal health check passed"

# Count timestamps - should see one every ~5 seconds
```

**Expected:**
- Health check log messages every 5 seconds (±0.5s)
- No missed checks
- Consistent timing

## Verification Checklist

After running all tests:

- [ ] Supervisor starts with Temporal
- [ ] Temporal auto-restarts after `kill -9` within 5 seconds
- [ ] Health check interval is 5 seconds
- [ ] Graceful shutdown: supervisor stops cleanly
- [ ] Clear logging for all restart events
- [ ] No goroutine leaks (no hanging processes after stop)
- [ ] Multiple restart cycles work reliably
- [ ] No restart attempts during shutdown

## Troubleshooting

### Supervisor Not Starting
- Check: `grep "supervisor" ~/.stigmer/logs/daemon.log`
- Verify: Temporal is configured as "managed" (not external)
- Check: No errors during Temporal start

### Auto-Restart Not Working
- Check: Health check logs appear every 5 seconds
- Verify: Temporal process is actually killed (`ps aux | grep temporal`)
- Check: PID file exists and is valid (`cat ~/.stigmer/temporal.pid`)

### Goroutine Leaks
- Check: `ps aux | grep stigmer` after stop - should show no processes
- Verify: No "context leak" errors in logs
- Check: Supervisor stop logs show "context cancelled"

## Success Criteria

All 6 tests pass with expected results and all checklist items verified.
