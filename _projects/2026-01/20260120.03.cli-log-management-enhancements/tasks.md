# Tasks: CLI Log Management Enhancements

**Project**: CLI Log Management Enhancements  
**Status**: ⏸️ TODO

---

## Task 1: Implement Log Rotation on Server Restart

**Status**: ✅ COMPLETE (Implementation done, testing pending)  
**Priority**: High (Most Impact)  
**Completed**: 2026-01-20

### Objective
Implement automatic log rotation when `stigmer server restart` is called, archiving old logs with timestamps instead of deleting them.

### Implementation Plan

**1. Rotation Strategy**

Option A: **Timestamp-based** (Recommended)
```
daemon.log → daemon.log.2026-01-20-231200
agent-runner.log → agent-runner.log.2026-01-20-231200
workflow-runner.log → workflow-runner.log.2026-01-20-231200
```

Option B: **Sequential numbering**
```
daemon.log → daemon.log.1
daemon.log.1 → daemon.log.2
```

**Decision**: Use Option A (timestamp-based) for easier identification and sorting.

**2. Implementation Location**

File: `client-apps/cli/internal/cli/daemon/daemon.go`  
Function: Add `rotateLogsIfNeeded()` called at daemon start

**3. Code Structure**

```go
// Call before starting services
func rotateLogsIfNeeded(dataDir string) error {
    logDir := filepath.Join(dataDir, "logs")
    timestamp := time.Now().Format("2006-01-02-150405")
    
    logFiles := []string{
        "daemon.log",
        "daemon.err",
        "agent-runner.log",
        "agent-runner.err",
        "workflow-runner.log",
        "workflow-runner.err",
    }
    
    for _, logFile := range logFiles {
        oldPath := filepath.Join(logDir, logFile)
        if _, err := os.Stat(oldPath); err == nil {
            newPath := filepath.Join(logDir, fmt.Sprintf("%s.%s", logFile, timestamp))
            os.Rename(oldPath, newPath)
        }
    }
    
    return nil
}
```

**4. Cleanup Old Rotations**

```go
func cleanupOldLogs(logDir string, keepDays int) error {
    // Delete logs older than keepDays
    cutoff := time.Now().AddDate(0, 0, -keepDays)
    
    files, _ := filepath.Glob(filepath.Join(logDir, "*.log.*"))
    for _, file := range files {
        info, _ := os.Stat(file)
        if info.ModTime().Before(cutoff) {
            os.Remove(file)
        }
    }
    return nil
}
```

### Steps
1. Add `rotateLogsIfNeeded()` function to daemon.go
2. Call it in `Start()` before launching services
3. Add `cleanupOldLogs()` to remove logs older than 7 days
4. Test rotation on restart
5. Verify old logs are archived, not deleted

### Success Criteria
- [x] Code implemented and integrated
- [x] `rotateLogsIfNeeded()` function added
- [x] `cleanupOldLogs()` function added
- [x] Integration with daemon startup
- [x] Timestamp-based naming (YYYY-MM-DD-HHMMSS)
- [x] Only rotates non-empty files
- [x] 7-day retention policy
- [x] Graceful error handling
- [ ] **Tested on restart** (manual testing pending)
- [ ] **Verified log archiving** (manual testing pending)
- [ ] **Verified cleanup** (manual testing pending)

---

## Task 2: Add `--all` Flag for Unified Log Viewing

**Status**: ✅ COMPLETE  
**Priority**: Medium  
**Completed**: 2026-01-20

### Objective
Add ability to view logs from all components in a single interleaved stream, sorted by timestamp.

### Implementation Plan

**1. Add Flag to Command**

File: `client-apps/cli/cmd/stigmer/root/server_logs.go`

```go
var (
    follow     bool
    lines      int
    component  string
    showStderr bool
    showAll    bool  // NEW
)

cmd.Flags().BoolVar(&showAll, "all", false, "Show logs from all components (interleaved)")
```

**2. Implement Log Interleaving**

```go
func streamAllLogs(logDir string, follow bool, tail int, showStderr bool) error {
    // Get all log files
    logFiles := getLogFiles(logDir, showStderr)
    
    if !follow {
        // Read and merge historical logs
        return showMergedLogs(logFiles, tail)
    }
    
    // Stream all logs in real-time
    return streamMergedLogs(logFiles, tail)
}

func showMergedLogs(logFiles []string, tail int) error {
    // 1. Read last N lines from each file
    // 2. Parse timestamps
    // 3. Sort by timestamp
    // 4. Print with component prefix
}
```

**3. Log Line Formatting**

```go
type LogLine struct {
    Timestamp time.Time
    Component string
    Line      string
}

func formatLogLine(line LogLine) string {
    component := fmt.Sprintf("[%-15s]", line.Component)
    return fmt.Sprintf("%s %s", component, line.Line)
}
```

**4. Multi-file Streaming**

For `--follow`, need to tail multiple files simultaneously:

```go
func streamMergedLogs(logFiles []string, tail int) error {
    // Use goroutines to tail each file
    lines := make(chan LogLine, 100)
    
    for _, file := range logFiles {
        go tailFile(file, lines)
    }
    
    // Print lines as they arrive (they'll be mostly in order)
    for line := range lines {
        fmt.Println(formatLogLine(line))
    }
}
```

### Steps
1. Add `--all` flag to command
2. Implement `streamAllLogs()` function
3. Parse timestamps from log lines
4. Merge and sort logs by timestamp
5. Format with component prefix
6. Test with `--follow` and without

### Success Criteria
- [x] `stigmer server logs --all` shows logs from all components
- [x] Logs are interleaved by timestamp
- [x] Each line shows component name in brackets
- [x] Works with `--follow` for real-time streaming
- [x] Works with `--tail` to limit output
- [x] Works with `--stderr` to show errors
- [x] Clean code architecture (new `logs` package)
- [x] All files under 150 lines
- [x] Proper error handling
- [x] Backward compatible (single component viewing still works)

---

## Task 3: Add Optional `--clear-logs` Flag

**Status**: ⏸️ TODO  
**Priority**: Low

### Objective
Provide explicit option to clear all logs on restart (for users who want it).

### Implementation Plan

**1. Add Flag to Restart Command**

File: `client-apps/cli/cmd/stigmer/root/server.go`

```go
var clearLogs bool

restartCmd.Flags().BoolVar(&clearLogs, "clear-logs", false, 
    "Clear all logs on restart (default: rotate and archive)")
```

**2. Conditional Behavior**

```go
if clearLogs {
    // Delete all logs
    os.RemoveAll(filepath.Join(dataDir, "logs"))
    os.MkdirAll(filepath.Join(dataDir, "logs"), 0755)
} else {
    // Rotate logs (default)
    rotateLogsIfNeeded(dataDir)
}
```

**3. Add Warning**

```go
if clearLogs {
    cliprint.PrintWarning("Clearing all logs - previous logs will be permanently deleted")
    cliprint.PrintInfo("To archive logs instead, omit the --clear-logs flag")
}
```

### Steps
1. Add `--clear-logs` flag to restart command
2. Implement conditional logic (clear vs rotate)
3. Add warning message when clearing
4. Update command help text
5. Test both modes

### Success Criteria
- [ ] `stigmer server restart --clear-logs` deletes all logs
- [ ] `stigmer server restart` (default) rotates logs
- [ ] User sees warning when using --clear-logs
- [ ] Help text explains the difference

---

## Task 4: Update Documentation

**Status**: ⏸️ TODO  
**Priority**: Medium

### Objective
Update documentation to explain new log management features.

### Files to Update

**1. `docs/cli/server-logs.md`**

Add sections for:
- Unified log viewing with `--all`
- Log rotation behavior
- Archived log location and naming
- Log cleanup policy

**2. `docs/cli/server.md`** (if exists)

Add section about restart behavior and log rotation.

**3. Command Help Text**

Update inline help for:
- `stigmer server logs --help`
- `stigmer server restart --help`

### Content to Add

**New Section: Log Rotation**

```markdown
## Log Rotation

Logs are automatically rotated on server restart.

### How It Works

When you run `stigmer server restart`, old logs are archived:

```bash
# Before restart
~/.stigmer/data/logs/
  daemon.log           # Current logs
  agent-runner.log
  workflow-runner.log

# After restart
~/.stigmer/data/logs/
  daemon.log           # New empty log
  agent-runner.log
  workflow-runner.log
  daemon.log.2026-01-20-231200       # Archived
  agent-runner.log.2026-01-20-231200
  workflow-runner.log.2026-01-20-231200
```

### Cleanup Policy

- Archived logs are kept for 7 days
- Logs older than 7 days are automatically deleted
- You can manually delete archived logs anytime
```

**New Section: Viewing All Logs**

```markdown
## Viewing All Component Logs

View logs from all components in a single interleaved stream:

```bash
# View all logs (interleaved by timestamp)
stigmer server logs --all

# With streaming
stigmer server logs --all -f

# Show only errors from all components
stigmer server logs --all --stderr
```

Example output:
```
[server]          2026/01/20 23:12:00 Starting gRPC server
[workflow-runner] 2026/01/20 23:12:00 Worker started  
[agent-runner]    2026/01/20 23:12:01 Connecting to MCP
[server]          2026/01/20 23:12:02 Server ready
```
```

### Steps
1. Update `docs/cli/server-logs.md` with new features
2. Add log rotation section
3. Add unified viewing examples
4. Update help text in commands
5. Review and proofread

### Success Criteria
- [ ] Documentation explains log rotation clearly
- [ ] Examples show `--all` flag usage
- [ ] Cleanup policy is documented
- [ ] Help text is accurate and helpful
- [ ] Links between related docs work

---

## Task 5: Test All Features Together

**Status**: ⏸️ TODO  
**Priority**: High

### Objective
Comprehensive testing of all log management features to ensure they work correctly together.

### Test Scenarios

**Test 1: Log Rotation**
```bash
# 1. Start server
stigmer server start

# 2. Generate some logs
stigmer apply

# 3. Restart server
stigmer server restart

# 4. Verify old logs archived
ls -lh ~/.stigmer/data/logs/

# Expected: See .log.2026-01-20-HHMMSS files
```

**Test 2: Unified Log Viewing**
```bash
# 1. View all component logs
stigmer server logs --all --tail 50

# Expected: See interleaved logs with component prefixes
```

**Test 3: Streaming All Logs**
```bash
# 1. Stream all logs
stigmer server logs --all -f

# 2. In another terminal, trigger activity
stigmer apply

# Expected: See logs from all components in real-time
```

**Test 4: Log Cleanup**
```bash
# 1. Create old log files (simulate)
touch -t 202601010000 ~/.stigmer/data/logs/daemon.log.2026-01-01-000000

# 2. Restart server
stigmer server restart

# 3. Verify old logs deleted
ls -lh ~/.stigmer/data/logs/

# Expected: 8-day-old log is gone
```

**Test 5: Clear Logs Flag**
```bash
# 1. Restart with clear
stigmer server restart --clear-logs

# 2. Verify all logs deleted
ls -lh ~/.stigmer/data/logs/

# Expected: Only current log files, no archives
```

### Edge Cases to Test

- [ ] Restart when no logs exist yet
- [ ] Restart when logs directory doesn't exist
- [ ] View logs when a component hasn't started
- [ ] View logs with --all when only one component has logs
- [ ] Rotation when log files are very large (GB+)
- [ ] Multiple restarts in quick succession

### Performance Testing

- [ ] Log rotation completes in < 1 second
- [ ] Viewing logs with --all is responsive
- [ ] Streaming with --all handles high log volume
- [ ] No memory leaks in streaming mode

### Success Criteria
- [ ] All test scenarios pass
- [ ] Edge cases handled gracefully
- [ ] Performance is acceptable
- [ ] No errors or warnings
- [ ] User experience is smooth

---

## Progress Summary

- **Total Tasks**: 5
- **Completed**: 2 (Task 1: Log Rotation, Task 2: Unified Viewing)
- **In Progress**: 0
- **Remaining**: 3

## Current Focus

**Recommended Order**:
1. Task 1 (Log Rotation) - Highest impact, fundamental feature
2. Task 4 (Documentation) - Can be done in parallel
3. Task 2 (Unified Viewing) - Nice to have, builds on rotation
4. Task 3 (Clear Logs Flag) - Optional, quick addition
5. Task 5 (Testing) - Verify everything works

## Estimated Effort

- Task 1: 1-2 hours (core rotation logic)
- Task 2: 2-3 hours (multi-file streaming is complex)
- Task 3: 30 minutes (simple flag addition)
- Task 4: 1 hour (documentation updates)
- Task 5: 1 hour (comprehensive testing)

**Total**: 5-7 hours for complete implementation
