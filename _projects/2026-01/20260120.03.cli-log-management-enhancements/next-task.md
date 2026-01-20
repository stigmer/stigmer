# Next Task: CLI Log Management Enhancements

**Project**: CLI Log Management Enhancements  
**Location**: `_projects/2026-01/20260120.03.cli-log-management-enhancements/`  
**Status**: 🚧 IN PROGRESS - Tasks 1 & 2 Complete

## Quick Context

Enhancing `stigmer server logs` command with three key improvements:
1. **Log rotation** on server restart (highest priority) ✅ **COMPLETE**
2. **Unified log viewing** with `--all` flag ✅ **COMPLETE**
3. **Better operational experience** matching Kubernetes/Docker patterns

**Goal**: Make log management feel professional and prevent log bloat.

---

## ✅ Task 1 Complete: Log Rotation

**Status**: Implementation complete, ready for testing  
**What Was Done**:
- Added `rotateLogsIfNeeded()` function to archive logs with timestamps
- Added `cleanupOldLogs()` function to delete logs older than 7 days
- Integrated rotation into daemon startup (before services start)
- Only rotates non-empty files
- Handles errors gracefully without stopping daemon

**Implementation Details**: See `task1-implementation.md`

**Test It Now**:
```bash
# Build and test the rotation
make release-local
stigmer server start
stigmer apply  # Generate some logs
stigmer server restart  # Should rotate logs
ls -lh ~/.stigmer/data/logs/  # Check for .log.TIMESTAMP files
```

---

## ✅ Task 2 Complete: Unified Log Viewing

**Status**: Implementation complete and tested  
**What Was Done**:
- Created new `internal/cli/logs` package with utilities
- Implemented timestamp parsing with multiple format support
- Implemented log merging for non-streaming mode
- Implemented multi-file streaming for follow mode
- Added component prefixes (`[server]`, `[agent-runner]`, `[workflow-runner]`)
- Integrated `--all` flag into command

**Implementation Details**: See `task2-implementation.md`

**Test It Now**:
```bash
# View last 20 lines from all components
stigmer server logs --all --follow=false --tail 20

# Stream all logs in real-time
stigmer server logs --all -f

# View error logs from all components
stigmer server logs --all --stderr --follow=false
```

---

## Recommended Next Steps

With Tasks 1 & 2 complete, you have three good options:

### Option A: Test Both Features (Recommended)
Verify everything works together:
```bash
# Test log rotation
stigmer server restart
ls -lh ~/.stigmer/data/logs/  # Check for archived logs

# Test unified viewing
stigmer server logs --all --tail 30 --follow=false

# Test streaming
stigmer server logs --all -f
```

### Option B: Continue with Task 4 (Documentation)
Document the new features while they're fresh:
- Update `docs/cli/server-logs.md`
- Add `--all` flag usage examples
- Document log rotation behavior
- Document 7-day cleanup policy

### Option C: Move to Task 3 (Clear Logs Flag)
Quick addition of `--clear-logs` flag for users who want to delete logs instead of archiving (30 min).

## What Log Rotation Does

**Before restart**:
```
~/.stigmer/data/logs/
  daemon.log           # Current logs (maybe 10 MB)
  agent-runner.log
  workflow-runner.log
```

**After restart**:
```
~/.stigmer/data/logs/
  daemon.log           # Fresh empty file
  agent-runner.log
  workflow-runner.log
  daemon.log.2026-01-20-231200       # Archived with timestamp
  agent-runner.log.2026-01-20-231200
  workflow-runner.log.2026-01-20-231200
```

**After 7 days**: Old archives are automatically deleted.

## Implementation Overview

### Step 1: Add Rotation Function (30 min)

Add to `daemon.go`:
```go
func rotateLogsIfNeeded(dataDir string) error {
    logDir := filepath.Join(dataDir, "logs")
    timestamp := time.Now().Format("2006-01-02-150405")
    
    logFiles := []string{
        "daemon.log", "daemon.err",
        "agent-runner.log", "agent-runner.err",
        "workflow-runner.log", "workflow-runner.err",
    }
    
    for _, logFile := range logFiles {
        oldPath := filepath.Join(logDir, logFile)
        if _, err := os.Stat(oldPath); err == nil {
            newPath := fmt.Sprintf("%s.%s", oldPath, timestamp)
            if err := os.Rename(oldPath, newPath); err != nil {
                return err
            }
        }
    }
    
    return nil
}
```

### Step 2: Call at Daemon Start (5 min)

In `Start()` function, before starting services:
```go
func Start(cmd *cobra.Command, args []string) {
    // ... existing code ...
    
    // Rotate logs before starting (NEW)
    if err := rotateLogsIfNeeded(dataDir); err != nil {
        log.Warn().Err(err).Msg("Failed to rotate logs")
        // Continue anyway - not fatal
    }
    
    // Start services...
}
```

### Step 3: Add Cleanup Function (30 min)

```go
func cleanupOldLogs(logDir string, keepDays int) error {
    cutoff := time.Now().AddDate(0, 0, -keepDays)
    
    pattern := filepath.Join(logDir, "*.log.*")
    files, err := filepath.Glob(pattern)
    if err != nil {
        return err
    }
    
    for _, file := range files {
        info, err := os.Stat(file)
        if err != nil {
            continue
        }
        if info.ModTime().Before(cutoff) {
            os.Remove(file)
        }
    }
    
    return nil
}
```

Call in `rotateLogsIfNeeded()`:
```go
// After rotating, cleanup old logs
cleanupOldLogs(logDir, 7) // Keep 7 days
```

### Step 4: Test (30 min)

```bash
# 1. Start server
stigmer server start

# 2. Generate some logs
stigmer apply

# 3. Check log files
ls -lh ~/.stigmer/data/logs/

# 4. Restart server
stigmer server restart

# 5. Verify logs were rotated
ls -lh ~/.stigmer/data/logs/
# Should see .log.2026-01-20-HHMMSS files

# 6. Check new logs are fresh
cat ~/.stigmer/data/logs/daemon.log
# Should be empty or only have new entries
```

## After Task 1 Is Complete

Move to Task 2 (Unified Viewing) or Task 4 (Documentation):
- **Task 2** adds the `--all` flag for viewing multiple components
- **Task 4** documents the new rotation feature

Both can be done independently, so pick what you prefer!

## Files to Modify

**Task 1 (Log Rotation)**:
- `client-apps/cli/internal/cli/daemon/daemon.go` (main implementation)

**Task 2 (Unified Viewing)**:
- `client-apps/cli/cmd/stigmer/root/server_logs.go` (add --all flag)
- Create: `client-apps/cli/internal/cli/logs/streaming.go` (new package)

**Task 4 (Documentation)**:
- `docs/cli/server-logs.md` (update with new features)

## Success Criteria for Task 1

- [ ] Logs are rotated on `stigmer server restart`
- [ ] Archived logs have timestamp in filename
- [ ] New log files start fresh (empty)
- [ ] Logs older than 7 days are deleted
- [ ] Process is fast (< 1 second)
- [ ] No errors if logs don't exist yet

## Common Issues & Solutions

**Issue**: "Permission denied" when rotating logs  
**Solution**: Check log directory permissions with `ls -la ~/.stigmer/data/logs/`

**Issue**: Old logs not being deleted  
**Solution**: Check `ModTime()` of files - may need to use file naming pattern to determine age

**Issue**: Rotation is slow with large logs  
**Solution**: `os.Rename()` is atomic and fast - shouldn't be an issue

## Related Resources

- Current logs location: `~/.stigmer/data/logs/`
- Daemon startup code: Lines 65-150 in daemon.go
- Server restart command: `client-apps/cli/cmd/stigmer/root/server.go`

---

**To resume**: Drag this file into chat or reference:  
`@_projects/2026-01/20260120.03.cli-log-management-enhancements/next-task.md`

**To view all tasks**:
`@_projects/2026-01/20260120.03.cli-log-management-enhancements/tasks.md`

**To check current logs**:
```bash
ls -lh ~/.stigmer/data/logs/
stigmer server logs -f
```
