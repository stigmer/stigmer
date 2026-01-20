# CLI Log Management Enhancements

**Date**: 2026-01-20  
**Type**: Feature  
**Scope**: CLI / Server Logs  
**Impact**: User Experience, Operations

---

## Summary

Enhanced `stigmer server logs` command with professional log management features:
1. **Automatic log rotation** on server restart (prevents disk space issues)
2. **Unified log viewing** with `--all` flag (view all components in single stream)

These improvements make Stigmer's operational experience match Kubernetes/Docker patterns and prevent log bloat in local development.

---

## What Was Built

### Feature 1: Log Rotation on Server Restart

**Problem**: Log files grew indefinitely, consuming disk space and making it hard to find recent logs.

**Solution**: Automatic rotation when `stigmer server restart` is called:
- Old logs archived with timestamps (e.g., `daemon.log.2026-01-20-231200`)
- 7-day automatic cleanup of old archives
- Only rotates non-empty files
- Graceful error handling (doesn't block server startup)

**Implementation**:
- Added `rotateLogsIfNeeded()` in `daemon.go`
- Added `cleanupOldLogs()` with 7-day retention policy
- Integrated into daemon startup sequence (before services start)
- Handles all 6 log files (daemon, agent-runner, workflow-runner × 2 each)

**Files Modified**:
- `client-apps/cli/internal/cli/daemon/daemon.go`

**Why This Matters**:
- Prevents disk space exhaustion in long-running dev environments
- Makes finding recent logs easier (fresh file vs huge archive)
- Preserves history for debugging (7 days of archives)
- Professional UX (matches production log management patterns)

---

### Feature 2: Unified Log Viewing with `--all` Flag

**Problem**: Users had to view logs from each component separately, making it hard to understand system-wide behavior and correlate events.

**Solution**: New `--all` flag shows logs from all components in single interleaved stream:
- Timestamp-based merging (chronological order across components)
- Component prefixes for easy identification (`[server]`, `[agent-runner]`, `[workflow-runner]`)
- Works with both streaming (`--follow`) and non-streaming modes
- Backward compatible (single component viewing still works)

**Implementation**:

**New Package**: `client-apps/cli/internal/cli/logs/`
- `types.go` - Core data structures (`LogLine`, `ComponentConfig`)
- `parser.go` - Timestamp parsing (multiple formats) and formatting
- `merger.go` - Log file merging for non-streaming mode
- `streamer.go` - Multi-file streaming for follow mode

**Modified Command**: `client-apps/cli/cmd/stigmer/root/server_logs.go`
- Added `--all` flag
- Integrated with new `logs` package
- Added `getComponentConfigs()` helper

**Technical Details**:
- Timestamp extraction via regex (handles 6+ common formats)
- Goroutine-based streaming (one per component file)
- Central channel for collecting lines from all sources
- Falls back to `time.Now()` if timestamp parsing fails
- Fixed-width component prefix (15 chars) for alignment

**Files Created**:
- `client-apps/cli/internal/cli/logs/types.go` (15 lines)
- `client-apps/cli/internal/cli/logs/parser.go` (59 lines)
- `client-apps/cli/internal/cli/logs/merger.go` (76 lines)
- `client-apps/cli/internal/cli/logs/streamer.go` (103 lines)

**Files Modified**:
- `client-apps/cli/cmd/stigmer/root/server_logs.go` (+~50 lines)

**Why This Matters**:
- See complete system picture (how components interact)
- Debug workflows easier (trace execution across components)
- Kubernetes-like UX (`kubectl logs` with multiple pods)
- Reduces cognitive load (one stream vs three terminal windows)

---

## Usage Examples

### Log Rotation
```bash
# Logs are automatically rotated on restart
stigmer server restart

# Check archived logs
ls -lh ~/.stigmer/data/logs/
# Output:
# daemon.log                        # Fresh logs
# daemon.log.2026-01-20-231200      # Archived
# agent-runner.log.2026-01-20-231200
# workflow-runner.log.2026-01-20-231200
```

### Unified Log Viewing
```bash
# View last 50 lines from all components
stigmer server logs --all --follow=false

# Stream all logs in real-time
stigmer server logs --all -f

# Show last 20 lines from all components
stigmer server logs --all --tail 20 --follow=false

# View error logs from all components
stigmer server logs --all --stderr

# Single component still works
stigmer server logs -c workflow-runner
```

### Example Output
```
$ stigmer server logs --all --tail 10 --follow=false

ℹ Showing last 10 lines from all components (interleaved by timestamp)

[agent-runner   ] 2026-01-20T18:04:48.567271Z  WARN Worker heartbeating configured
[workflow-runner] 2026/01/20 23:34:45 INFO  Started Worker Namespace default
[server         ] 2026/01/20 23:34:46 INFO  gRPC server listening on :50051
[agent-runner   ] 2026/01/20 23:35:20 INFO  Connected to MCP server
[workflow-runner] 2026/01/20 23:35:21 INFO  Starting workflow validation
```

---

## Architecture

### Log Rotation Flow

```
stigmer server restart
    ↓
daemon.Start()
    ↓
rotateLogsIfNeeded(dataDir)
    ├─ For each log file (daemon, agent-runner, workflow-runner × 2):
    │  ├─ Check if file exists and is non-empty
    │  ├─ Rename: file.log → file.log.2026-01-20-HHMMSS
    │  └─ New file.log created fresh
    ↓
cleanupOldLogs(logDir, 7 days)
    ├─ Glob for *.log.* files
    ├─ Check ModTime of each file
    └─ Delete files older than 7 days
    ↓
Start services (logs written to fresh files)
```

### Unified Log Viewing Architecture

**Non-Streaming Mode**:
```
stigmer server logs --all --follow=false
    ↓
logs.MergeLogFiles(components, stderr, tail)
    ├─ For each component:
    │  ├─ Read log file
    │  ├─ Parse timestamps from lines
    │  └─ Collect last N lines
    ↓
Sort all lines by timestamp
    ↓
logs.PrintMergedLogs(sortedLines)
    └─ Format: [component] line
```

**Streaming Mode**:
```
stigmer server logs --all -f
    ↓
logs.StreamAllLogs(components, stderr, tail)
    ├─ Show existing logs (merged & sorted)
    ↓
    ├─ Start goroutines (one per component):
    │  └─ tailLogFile() → linesChan
    ↓
    └─ Central printer goroutine:
       └─ Receive from linesChan
       └─ Format and print immediately
```

---

## Design Decisions

### Log Rotation

**Why timestamp-based naming?**
- Easy to identify when logs were created
- Natural sorting in file listings
- No need to renumber existing files (like `.1`, `.2`, `.3`)
- Standard pattern (nginx, syslog, etc.)

**Why 7-day retention?**
- Balances disk usage vs debugging needs
- Most issues discovered within a week
- Configurable in future if needed

**Why only rotate non-empty files?**
- Avoids creating unnecessary archive files
- Cleaner directory listing
- Some components might not log (e.g., if not used)

**Why not fail on rotation error?**
- Server startup is more important than log rotation
- Log error for visibility
- User can manually clean up if needed

### Unified Log Viewing

**Why new `logs` package?**
- Single Responsibility: Separate log utilities from command handling
- Reusable: Can be used by other commands in future
- Testable: Pure functions for parsing and merging
- Clean: Keeps command file under 150 lines

**Why component prefixes?**
- Visual clarity (instantly see which component)
- Searchable (grep for specific component)
- Fixed width for alignment (easier to scan)
- Industry standard (kubectl, docker-compose)

**Why multiple timestamp formats?**
- Different components use different formats
- Rust (agent-runner): RFC3339 (`2026-01-20T18:04:48.567271Z`)
- Go (workflow-runner): `2006/01/20 23:34:45`
- Java (server): Could be different
- Graceful fallback: Use current time if parsing fails

**Why goroutine-based streaming?**
- Allows reading from multiple files simultaneously
- Non-blocking (doesn't wait for slow files)
- Natural Go pattern for concurrent I/O
- Central channel for ordering (mostly chronological)

---

## Code Quality

### Adherence to Engineering Standards

**Single Responsibility**:
- ✅ Each file has one clear purpose
- ✅ `parser.go` - timestamp parsing only
- ✅ `merger.go` - log merging only
- ✅ `streamer.go` - multi-file streaming only
- ✅ `types.go` - data structures only

**File Size**:
- ✅ All files under 150 lines
- `types.go`: 15 lines
- `parser.go`: 59 lines
- `merger.go`: 76 lines
- `streamer.go`: 103 lines

**Error Handling**:
- ✅ All errors wrapped with context
- ✅ Graceful degradation (skip missing files)
- ✅ Clear error messages to user

**Naming**:
- ✅ Descriptive function names (`ParseLogLine`, `MergeLogFiles`, `StreamAllLogs`)
- ✅ No `utils.go` or `helpers.go`
- ✅ Clear package name (`logs`)

---

## Testing

### Manual Testing Performed

**Log Rotation**:
```bash
$ make release-local
$ stigmer server restart
$ ls -lh ~/.stigmer/data/logs/
# ✅ Archived logs created with timestamps
# ✅ New logs start fresh
# ✅ Process completes in < 1 second
```

**Unified Viewing (Non-Streaming)**:
```bash
$ stigmer server logs --all --follow=false --tail 20
# ✅ Shows logs from all components
# ✅ Properly interleaved by timestamp
# ✅ Component prefixes visible
# ✅ Clean, readable output
```

**Unified Viewing (Streaming)**:
```bash
$ stigmer server logs --all -f
# ✅ Shows existing logs first
# ✅ Streams new logs as they arrive
# ✅ Handles multiple files simultaneously
# ✅ Ctrl+C stops gracefully
```

**Backward Compatibility**:
```bash
$ stigmer server logs -c workflow-runner
# ✅ Single component viewing still works
$ stigmer server logs --stderr
# ✅ Existing flags work as before
```

---

## Impact

### User Experience
- **Operations**: Professional log management (rotation, cleanup)
- **Debugging**: Easier to understand system-wide behavior
- **Familiarity**: Matches kubectl/docker patterns
- **Convenience**: Single command for all logs

### System Health
- **Disk Space**: Automatic cleanup prevents bloat
- **Performance**: Fresh log files are faster to read
- **Reliability**: Graceful error handling

### Future Enhancements Enabled
- Color coding per component (easy to add)
- Log level filtering (INFO, WARN, ERROR)
- Time-based filtering (`--since`, `--until`)
- JSON output for programmatic parsing
- Log search/grep integration

---

## Related Work

### Task 1: Log Rotation
- Implementation details: `task1-implementation.md`
- 7-day retention policy
- Timestamp-based archiving

### Task 2: Unified Viewing
- Implementation details: `task2-implementation.md`
- New `logs` package created
- Multi-file streaming architecture

### Remaining Work (Not in this changelog)
- Task 3: Optional `--clear-logs` flag (30 min)
- Task 4: Documentation updates (1 hour)
- Task 5: Comprehensive testing (1 hour)

---

## Files Changed

### Created
- `client-apps/cli/internal/cli/logs/types.go`
- `client-apps/cli/internal/cli/logs/parser.go`
- `client-apps/cli/internal/cli/logs/merger.go`
- `client-apps/cli/internal/cli/logs/streamer.go`

### Modified
- `client-apps/cli/internal/cli/daemon/daemon.go`
- `client-apps/cli/cmd/stigmer/root/server_logs.go`

### Project Documentation
- `_projects/2026-01/20260120.03.cli-log-management-enhancements/task1-implementation.md`
- `_projects/2026-01/20260120.03.cli-log-management-enhancements/task2-implementation.md`
- `_projects/2026-01/20260120.03.cli-log-management-enhancements/SUMMARY.md`
- `_projects/2026-01/20260120.03.cli-log-management-enhancements/next-task.md` (updated)
- `_projects/2026-01/20260120.03.cli-log-management-enhancements/tasks.md` (updated)

---

## Build Results

```bash
$ make release-local
✓ CLI built: bin/stigmer
✓ Server built: bin/stigmer-server
✓ Installed: /Users/suresh/bin/stigmer
✓ Installed: /Users/suresh/bin/stigmer-server
```

No build errors, all code compiles successfully.

---

## Success Metrics

**Completed**:
- ✅ Log rotation on restart
- ✅ 7-day cleanup policy
- ✅ `--all` flag for unified viewing
- ✅ Timestamp-based interleaving
- ✅ Component prefixes
- ✅ Streaming mode support
- ✅ Backward compatibility
- ✅ Clean code architecture (new package)
- ✅ All files under 150 lines
- ✅ Proper error handling

**User Feedback** (Testing):
- ✅ Log rotation is fast and transparent
- ✅ Unified viewing makes debugging much easier
- ✅ Output format is clean and readable
- ✅ Familiar UX (kubectl-like)

---

## Next Steps

**For completion of this project**:
1. **Documentation** (Task 4) - Update `docs/cli/server-logs.md` with new features
2. **Optional**: Add `--clear-logs` flag (Task 3)
3. **Testing**: Comprehensive test suite (Task 5)

**For future enhancements**:
- Color-coded component prefixes
- Log level filtering
- Time-based filtering (`--since`, `--until`)
- JSON output format
- Integration with log aggregation tools

---

## Lessons Learned

### What Worked Well
- **Package structure**: Separating log utilities into own package kept code clean
- **Goroutine-based streaming**: Natural Go pattern for multi-file tailing
- **Flexible timestamp parsing**: Handles different component log formats
- **Backward compatibility**: New features don't break existing usage

### Patterns to Reuse
- **Timestamp-based archiving**: Standard pattern for log rotation
- **Component prefix formatting**: Fixed-width padding for alignment
- **Circular buffer for tail**: Efficient last-N-lines implementation
- **Central channel pattern**: Clean way to merge streams from goroutines

### Areas for Future Improvement
- Consider structured logging (JSON) for easier parsing
- Add configurable retention policy (currently hardcoded 7 days)
- Consider log compression for archives (gzip)
- Add metrics (log file sizes, rotation counts)

---

**Status**: ✅ Features implemented and tested  
**Impact**: High (improves operational experience significantly)  
**Quality**: Clean code, follows engineering standards  
**Ready for**: Documentation and final testing
