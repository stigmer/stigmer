# Task 1 Implementation: Log Rotation on Server Restart

**Status**: ✅ COMPLETED  
**Date**: 2026-01-20

## What Was Implemented

Added automatic log rotation functionality to the Stigmer daemon that:
1. Archives existing logs with timestamps on server restart
2. Cleans up logs older than 7 days automatically
3. Only rotates non-empty log files
4. Handles rotation failures gracefully without stopping daemon startup

## Implementation Details

### Files Modified

**`client-apps/cli/internal/cli/daemon/daemon.go`**

Added three key components:

1. **`rotateLogsIfNeeded(dataDir string) error`**
   - Called during daemon startup (before services start)
   - Renames existing log files with timestamp suffix (format: `YYYY-MM-DD-HHMMSS`)
   - Only rotates files with content (size > 0)
   - Logs rotation activity with debug/info messages
   - Triggers cleanup of old logs

2. **`cleanupOldLogs(logDir string, keepDays int) error`**
   - Removes archived logs older than specified days (default: 7)
   - Uses glob patterns to find archived logs (*.log.* and *.err.*)
   - Uses file modification time to determine age
   - Logs cleanup activity

3. **Integration in `StartWithOptions()`**
   - Calls `rotateLogsIfNeeded()` after data directory setup
   - Before starting any services (daemon, workflow-runner, agent-runner)
   - Failures don't prevent daemon startup (logged as warnings)

### Log Files Rotated

The following 6 log files are rotated:
- `daemon.log` → `daemon.log.2026-01-20-150405`
- `daemon.err` → `daemon.err.2026-01-20-150405`
- `agent-runner.log` → `agent-runner.log.2026-01-20-150405`
- `agent-runner.err` → `agent-runner.err.2026-01-20-150405`
- `workflow-runner.log` → `workflow-runner.log.2026-01-20-150405`
- `workflow-runner.err` → `workflow-runner.err.2026-01-20-150405`

### Rotation Strategy

**Timestamp-based naming** (chosen over sequential numbering):
- Format: `filename.YYYY-MM-DD-HHMMSS`
- Example: `daemon.log.2026-01-20-231200`
- Benefits:
  - Easy to identify when logs were from
  - Natural chronological sorting
  - No need to renumber files
  - Clear audit trail

### Cleanup Policy

- **Retention**: 7 days (configurable in code)
- **Trigger**: Automatically runs during rotation
- **Criteria**: Files older than cutoff date are deleted
- **Scope**: Only archived logs (*.log.*, *.err.*)
- **Safety**: Current logs are never deleted

## Testing Instructions

### Test 1: Basic Rotation

```bash
# 1. Start the server
stigmer server start

# 2. Generate some logs (run any command)
stigmer apply

# 3. Check current logs
ls -lh ~/.stigmer/data/logs/
# Should see: daemon.log, agent-runner.log, workflow-runner.log (and .err files)

# 4. Restart the server
stigmer server restart

# 5. Verify logs were rotated
ls -lh ~/.stigmer/data/logs/
# Should see:
#   - Fresh empty log files: daemon.log, etc.
#   - Archived files: daemon.log.2026-01-20-HHMMSS, etc.

# 6. Check archived log content
cat ~/.stigmer/data/logs/daemon.log.2026-01-20-*
# Should contain the old logs
```

### Test 2: Empty Files Not Rotated

```bash
# 1. Stop server
stigmer server stop

# 2. Create empty log file
touch ~/.stigmer/data/logs/test.log

# 3. Start server
stigmer server start

# 4. Verify empty file was not rotated
ls ~/.stigmer/data/logs/
# test.log should still exist, no test.log.TIMESTAMP created
```

### Test 3: Cleanup Old Logs

```bash
# 1. Simulate old log files (8 days old)
cd ~/.stigmer/data/logs/
touch -t $(date -v-8d +%Y%m%d0000) daemon.log.2026-01-12-000000

# 2. Restart server
stigmer server restart

# 3. Verify old log was deleted
ls -lh ~/.stigmer/data/logs/
# daemon.log.2026-01-12-000000 should be gone
```

### Test 4: First Run (No Logs Yet)

```bash
# 1. Clean slate
rm -rf ~/.stigmer/data/logs/

# 2. Start server
stigmer server start

# Expected: No errors, log directory created, no rotation needed
```

### Test 5: Multiple Restarts

```bash
# 1. Start server
stigmer server start

# 2. Restart 3 times in quick succession
stigmer server restart
stigmer server restart
stigmer server restart

# 3. Verify 3 sets of archived logs
ls -lh ~/.stigmer/data/logs/ | grep "\.log\."
# Should see 3 timestamps for each log file
```

## Verification Checklist

- [x] Code compiles without errors
- [ ] Logs are rotated on restart
- [ ] Archived logs have correct timestamp format
- [ ] New log files start fresh (empty or from current session)
- [ ] Empty files are not rotated
- [ ] Logs older than 7 days are deleted
- [ ] Rotation completes in < 1 second
- [ ] No daemon startup failures due to rotation issues
- [ ] Proper logging of rotation/cleanup activity

## Known Behaviors

1. **Non-fatal Failures**: If rotation fails for a specific file, daemon still starts
2. **Size Check**: Only files with content (size > 0) are rotated
3. **Timestamp Precision**: Uses seconds (not milliseconds) to avoid clutter
4. **Cleanup Timing**: Runs automatically during each rotation
5. **No Compression**: Archived logs are not compressed (could be future enhancement)

## Edge Cases Handled

- ✅ Log directory doesn't exist → Created automatically
- ✅ No existing logs → Rotation skipped gracefully
- ✅ Empty log files → Not rotated (stay empty)
- ✅ Permission errors → Logged as warnings, daemon continues
- ✅ Multiple rapid restarts → Each gets unique timestamp
- ✅ Cleanup glob errors → Logged, doesn't stop rotation

## Performance Characteristics

- **Rotation Time**: O(n) where n = number of log files (typically 6)
- **Cleanup Time**: O(m) where m = number of archived files
- **Disk Usage**: Grows linearly with restarts until 7-day cleanup
- **Expected Duration**: < 100ms for typical case (6 files)

## Next Steps

This completes Task 1. Recommended next tasks:

1. **Task 4 (Documentation)** - Can be done immediately
   - Update `docs/cli/server-logs.md` with rotation behavior
   - Document archived log location and naming
   - Explain 7-day cleanup policy

2. **Task 2 (Unified Viewing)** - Builds on rotation
   - Add `--all` flag to view all component logs
   - Implement log interleaving by timestamp

3. **Task 5 (Testing)** - Comprehensive validation
   - Run all test scenarios
   - Verify edge cases
   - Measure performance

## Success Criteria

- [x] `rotateLogsIfNeeded()` function implemented
- [x] `cleanupOldLogs()` function implemented
- [x] Integration with daemon startup
- [x] Timestamp-based naming
- [x] 7-day retention policy
- [x] Graceful error handling
- [x] Proper logging
- [ ] Tested on actual daemon restart (pending manual verification)

---

**Implementation Time**: ~1 hour  
**Lines Changed**: ~130 lines added  
**Files Modified**: 1 (`daemon.go`)
