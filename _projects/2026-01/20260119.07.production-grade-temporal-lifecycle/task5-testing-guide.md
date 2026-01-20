# Task 5 Testing Guide: Lock File Implementation

## Overview
This guide provides step-by-step instructions to test the lock file functionality that prevents concurrent Temporal instances and automatically releases on crash.

## Prerequisites
- Build the CLI: `cd client-apps/cli && go build -o /tmp/stigmer-cli ./cmd/stigmer`
- Ensure no existing Stigmer processes are running: `/tmp/stigmer-cli local stop`
- Clean up any existing lock/PID files: `rm -f ~/.stigmer/temporal.lock ~/.stigmer/temporal.pid`

## Test 1: Lock File Created on Start

**Objective:** Verify lock file is created and held when Temporal starts

```bash
# Start stigmer local
/tmp/stigmer-cli local

# Check if lock file exists
ls -la ~/.stigmer/temporal.lock

# Check file descriptor is held
lsof ~/.stigmer/temporal.lock
```

**Expected:**
- Lock file exists at `~/.stigmer/temporal.lock`
- File descriptor is held by temporal process
- PID file also exists at `~/.stigmer/temporal.pid` (for debugging)

## Test 2: Lock Prevents Concurrent Instances

**Objective:** Verify second instance cannot start while first is running

```bash
# Terminal 1: Start stigmer
/tmp/stigmer-cli local

# Terminal 2: Try to start again
/tmp/stigmer-cli local
```

**Expected Terminal 2:**
- Log message: "Temporal is already running (lock file held) - reusing existing instance"
- Command succeeds (idempotent behavior)
- No second Temporal process started
- First instance continues running normally

## Test 3: Lock Released on Graceful Stop

**Objective:** Verify lock is properly released on clean shutdown

```bash
# Start stigmer
/tmp/stigmer-cli local

# Verify lock is held
lsof ~/.stigmer/temporal.lock

# Stop stigmer
/tmp/stigmer-cli local stop

# Verify lock is released
lsof ~/.stigmer/temporal.lock  # Should show no results

# Verify can restart
/tmp/stigmer-cli local
```

**Expected:**
- After stop, `lsof` shows no process holding lock file
- Lock file may still exist (empty file is OK)
- Restart succeeds without errors
- New lock is acquired on restart

## Test 4: Lock Auto-Released on Crash

**Objective:** Verify lock is automatically released when process dies

```bash
# Terminal 1: Start stigmer and watch logs
/tmp/stigmer-cli local
tail -f ~/.stigmer/logs/daemon.log

# Terminal 2: Force kill Temporal (simulate crash)
ps aux | grep temporal
kill -9 <temporal-pid>

# Terminal 2: Verify lock is released
lsof ~/.stigmer/temporal.lock  # Should show no results

# Terminal 2: Restart should work
/tmp/stigmer-cli local
```

**Expected:**
- After `kill -9`, lock is automatically released by OS
- Restart succeeds without manual cleanup
- New instance can acquire lock
- Supervisor auto-restart works (from Task 4)

## Test 5: Stale Lock File Cleanup

**Objective:** Verify system handles stale lock files from crashes

```bash
# Simulate crash by killing Temporal
/tmp/stigmer-cli local
temporal_pid=$(ps aux | grep -v grep | grep temporal | awk '{print $2}' | head -1)
kill -9 $temporal_pid

# Lock should be auto-released, but verify
lsof ~/.stigmer/temporal.lock

# Start should work immediately (no manual cleanup)
/tmp/stigmer-cli local
```

**Expected:**
- Lock is not held after crash (`lsof` shows nothing)
- Start succeeds without errors
- No manual intervention required
- More reliable than PID-based detection

## Test 6: Lock vs PID File Comparison

**Objective:** Demonstrate lock file is more reliable than PID file

```bash
# Start Temporal
/tmp/stigmer-cli local

# Get Temporal PID
temporal_pid=$(cat ~/.stigmer/temporal.pid | head -1)
echo "Temporal PID: $temporal_pid"

# Simulate PID reuse scenario (manual test)
# 1. Kill Temporal
kill -9 $temporal_pid

# 2. Check lock status vs PID file
echo "Lock status:"
lsof ~/.stigmer/temporal.lock  # Should be released

echo "PID file:"
cat ~/.stigmer/temporal.pid  # Still exists but stale

# 3. Start should work (lock-based detection catches this)
/tmp/stigmer-cli local
```

**Expected:**
- Lock file detection is more reliable than PID file
- PID file may exist after crash, but lock is released
- Start uses lock as primary check (faster, more accurate)
- PID file kept for debugging purposes

## Test 7: Lock Behavior Across Restarts

**Objective:** Verify lock handling through multiple start/stop cycles

```bash
# Test 3 complete cycles
for i in {1..3}; do
  echo "=== Cycle $i ==="
  
  # Start
  /tmp/stigmer-cli local
  lsof ~/.stigmer/temporal.lock | grep -q temporal && echo "Lock held: YES" || echo "Lock held: NO"
  
  # Stop
  sleep 2
  /tmp/stigmer-cli local stop
  lsof ~/.stigmer/temporal.lock | grep -q temporal && echo "Lock held: YES" || echo "Lock held: NO"
  
  sleep 1
done
```

**Expected:**
- Each cycle: lock acquired on start, released on stop
- No lock leaks between cycles
- All 3 cycles complete without errors
- Consistent behavior across restarts

## Test 8: Concurrent Start Attempts (Race Condition)

**Objective:** Verify lock prevents race conditions during concurrent starts

```bash
# In separate terminals, try to start simultaneously
# Terminal 1:
/tmp/stigmer-cli local &

# Terminal 2 (immediately after):
/tmp/stigmer-cli local &

# Wait for both to complete
wait

# Check only one Temporal is running
ps aux | grep temporal | grep -v grep
```

**Expected:**
- Only one Temporal process running
- Both commands succeed (idempotent)
- First acquires lock, second detects lock and reuses
- No race condition or duplicate instances

## Verification Checklist

After running all tests:

- [ ] Lock file created when Temporal starts
- [ ] Lock file held by Temporal process (verified with `lsof`)
- [ ] Second instance detects lock and reuses existing instance
- [ ] Lock released on graceful stop
- [ ] Lock auto-released on crash (`kill -9`)
- [ ] Restart works immediately after crash (no manual cleanup)
- [ ] Lock-based detection faster than PID-based
- [ ] PID file still written (for debugging)
- [ ] Multiple start/stop cycles work reliably
- [ ] Concurrent start attempts prevented by lock

## Troubleshooting

### Lock File Not Created
- Check: `ls -la ~/.stigmer/temporal.lock`
- Verify: Directory `~/.stigmer/` exists and is writable
- Check: Logs for "failed to acquire lock" errors

### Lock Not Released After Stop
- Check: `lsof ~/.stigmer/temporal.lock` after stop
- Verify: All Temporal processes are killed (`ps aux | grep temporal`)
- Manual cleanup: `rm -f ~/.stigmer/temporal.lock` (should rarely be needed)

### Second Instance Still Starts
- Check: Lock detection logic in `Start()` method
- Verify: `isLocked()` returns true when lock is held
- Check: Logs show "lock file held" message

### Lock Released Too Early
- Check: Lock file descriptor is stored in `m.lockFd`
- Verify: Lock is not released until `Stop()` is called
- Check: Process holds lock throughout its lifetime

## Implementation Details

### Lock File Location
- Path: `~/.stigmer/temporal.lock`
- Mechanism: `syscall.Flock` with `LOCK_EX | LOCK_NB` (exclusive, non-blocking)

### Key Functions
- `acquireLock()`: Acquires exclusive lock before starting Temporal
- `releaseLock()`: Releases lock on stop (automatic on process death)
- `isLocked()`: Checks if lock is currently held by another process

### Lock vs PID File
- **Lock File**: Source of truth, auto-released on crash, prevents concurrent instances
- **PID File**: Kept for debugging, can be stale, not relied upon for detection

## Success Criteria

All 8 tests pass with expected results and all checklist items verified.

## Additional Notes

### Why Lock Files Are Better Than PID Files

1. **Auto-release on crash**: OS releases lock when process dies, no stale locks
2. **Atomic operation**: `flock` is atomic, prevents race conditions
3. **No PID reuse issues**: Lock is tied to process, not PID number
4. **Faster detection**: Lock check is instant, no need to validate process

### Backward Compatibility

- PID file still written for debugging purposes
- Can be used to identify which process holds the lock
- Enhanced format includes: PID, command name, timestamp
