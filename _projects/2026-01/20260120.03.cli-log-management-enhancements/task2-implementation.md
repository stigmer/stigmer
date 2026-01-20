# Task 2 Implementation: Unified Log Viewing with `--all` Flag

**Status**: ✅ COMPLETE  
**Completed**: 2026-01-20  
**Implementation Time**: ~45 minutes

---

## Summary

Added `--all` flag to `stigmer server logs` command to view logs from all components (server, agent-runner, workflow-runner) in a single interleaved stream, sorted by timestamp.

## What Was Implemented

### 1. New Internal Package: `internal/cli/logs`

Created a new package with log streaming utilities:

**Files Created**:
- `internal/cli/logs/types.go` - Core data structures
- `internal/cli/logs/parser.go` - Timestamp parsing and formatting
- `internal/cli/logs/merger.go` - Log merging for non-streaming mode
- `internal/cli/logs/streamer.go` - Multi-file streaming for follow mode

### 2. Key Features

**Timestamp Parsing**:
- Automatically detects timestamps in multiple formats:
  - `2026/01/20 23:12:00`
  - `2026-01-20T23:12:00`
  - `2026-01-20 23:12:00`
  - RFC3339 and RFC3339Nano
- Falls back to current time if no timestamp found

**Component Prefixes**:
- Each log line shows its source component
- Format: `[component-name] log message`
- Fixed-width padding (15 chars) for alignment

**Timestamp-based Interleaving**:
- Logs from all components are sorted by timestamp
- Shows chronological order of events across the system
- Makes it easy to correlate behavior between components

### 3. Updated Command

Modified `cmd/stigmer/root/server_logs.go` to:
- Add `--all` flag
- Integrate with new `logs` package
- Support both streaming (`--follow`) and non-streaming modes
- Maintain backward compatibility (single component viewing still works)

## Usage Examples

### View Last 50 Lines from All Components
```bash
stigmer server logs --all --follow=false
```

### Stream All Logs in Real-Time
```bash
stigmer server logs --all
# or
stigmer server logs --all -f
```

### Show Last 20 Lines from All Components
```bash
stigmer server logs --all --tail 20 --follow=false
```

### View Error Logs from All Components
```bash
stigmer server logs --all --stderr
```

### Still Works: Single Component Viewing
```bash
stigmer server logs --component workflow-runner
stigmer server logs -c agent-runner -f
```

## Example Output

```bash
$ stigmer server logs --all --tail 10 --follow=false

ℹ Showing last 10 lines from all components (interleaved by timestamp)

[agent-runner   ] 2026-01-20T18:04:48.567271Z  WARN Worker heartbeating configured
[workflow-runner] 2026/01/20 23:34:45 INFO  Started Worker Namespace default
[workflow-runner] 2026/01/20 23:34:45 INFO  Started Worker TaskQueue workflow_execution_runner
[server         ] 2026/01/20 23:34:46 INFO  gRPC server listening on :50051
[agent-runner   ] 2026/01/20 23:35:20 INFO  Connected to MCP server
[workflow-runner] 2026/01/20 23:35:21 INFO  Starting workflow validation
[workflow-runner] 2026/01/20 23:35:21 INFO  Step 1: Generating YAML from WorkflowSpec proto
[workflow-runner] 2026/01/20 23:35:21 INFO  YAML generation succeeded
[server         ] 2026/01/20 23:35:22 INFO  Workflow validation completed
```

## Architecture

### Non-Streaming Mode (`--follow=false`)

```
┌─────────────────────────────────────────────┐
│  server_logs.go (Command Handler)          │
└─────────────────────┬───────────────────────┘
                      │
                      v
┌─────────────────────────────────────────────┐
│  logs.MergeLogFiles()                       │
│  - Read all component log files             │
│  - Parse timestamps from each line          │
│  - Collect last N lines from each file      │
│  - Merge and sort by timestamp              │
└─────────────────────┬───────────────────────┘
                      │
                      v
┌─────────────────────────────────────────────┐
│  logs.PrintMergedLogs()                     │
│  - Format with component prefix             │
│  - Print to stdout                          │
└─────────────────────────────────────────────┘
```

### Streaming Mode (`--follow`)

```
┌─────────────────────────────────────────────┐
│  server_logs.go (Command Handler)          │
└─────────────────────┬───────────────────────┘
                      │
                      v
┌─────────────────────────────────────────────┐
│  logs.StreamAllLogs()                       │
│  1. Show existing logs (merged & sorted)    │
│  2. Start streaming new logs               │
└─────────────────────┬───────────────────────┘
                      │
                      v
┌─────────────────────────────────────────────┐
│  Goroutine per component file               │
│  - tailLogFile() for each component         │
│  - Read new lines as they're written        │
│  - Send to central channel                  │
└─────────────────────┬───────────────────────┘
                      │
                      v
┌─────────────────────────────────────────────┐
│  Central printer goroutine                  │
│  - Receives log lines from all components   │
│  - Formats with component prefix            │
│  - Prints immediately to stdout             │
└─────────────────────────────────────────────┘
```

## Technical Details

### Log Line Parsing

The `ParseLogLine()` function:
1. Uses regex to extract timestamp from beginning of line
2. Tries multiple timestamp formats (Go format strings)
3. Falls back to `time.Now()` if parsing fails
4. Preserves original line content

### Multi-File Streaming

The streaming implementation:
- Uses goroutines to tail each file independently
- Central channel (`chan LogLine`) for collecting lines
- Buffered channel (100 entries) to prevent blocking
- Handles file truncation/rotation gracefully
- Polls every 100ms for new content

### Component Prefixes

Format: `[component-name] original line`
- Fixed width (15 chars) for alignment
- Right-padded with spaces
- Makes it easy to visually scan for specific components

## Testing Results

### Non-Streaming Mode ✅
```bash
$ stigmer server logs --all --follow=false --tail 20
ℹ Showing last 20 lines from all components (interleaved by timestamp)

[agent-runner   ] 2026-01-20T18:04:48.567271Z  WARN ...
[workflow-runner] 2026/01/20 23:34:45 INFO  ...
[workflow-runner] 2026/01/20 23:34:45 INFO  ...
# ... logs properly interleaved by timestamp
```

### Streaming Mode ✅
```bash
$ stigmer server logs --all --tail 5
ℹ Streaming logs from all components (interleaved by timestamp)
ℹ Press Ctrl+C to stop

# Shows last 5 lines first, then streams new logs in real-time
# Successfully receives logs from all components as they're written
```

### Backward Compatibility ✅
```bash
$ stigmer server logs -c workflow-runner
# Still works as before - single component viewing
```

## Code Quality

### File Sizes
- `types.go`: 15 lines (data structures)
- `parser.go`: 59 lines (timestamp parsing)
- `merger.go`: 76 lines (log merging)
- `streamer.go`: 103 lines (multi-file streaming)
- `server_logs.go`: Modified ~50 lines

All files under 150 lines ✅

### Principles Applied
- **Single Responsibility**: Each file has one clear purpose
- **Separation of Concerns**: Parsing, merging, streaming in separate files
- **Interface-Based**: `ComponentConfig` allows easy extension
- **Error Handling**: All errors properly wrapped with context
- **Graceful Degradation**: Skips non-existent log files instead of failing

## Benefits

### For Users
1. **Unified View**: See all components at once
2. **Chronological Order**: Understand event sequence across system
3. **Easy Correlation**: Trace how actions flow between components
4. **Familiar UX**: Similar to `kubectl logs` with multiple pods

### For Debugging
1. **Workflow Execution**: See agent-runner ↔ workflow-runner interaction
2. **Server Requests**: Correlate API calls with worker activity
3. **Error Investigation**: See which component failed first
4. **Performance Analysis**: Track timing across components

## Future Enhancements (Not Implemented)

Potential improvements for later:
- Add color coding per component
- Add `--grep` flag to filter logs
- Add `--since` flag (time-based filtering)
- Add JSON output format for programmatic parsing
- Add log level filtering (INFO, WARN, ERROR)

## Related Features

Works seamlessly with:
- **Task 1**: Log rotation (rotated logs are excluded)
- **Existing flags**: `--tail`, `--stderr`, `--follow`
- **Single component mode**: Still available with `-c` flag

## Success Criteria ✅

- [x] `stigmer server logs --all` shows logs from all components
- [x] Logs are interleaved by timestamp
- [x] Each line shows component name in brackets
- [x] Works with `--follow` for real-time streaming
- [x] Works with `--tail` to limit output
- [x] Works with `--stderr` to show errors
- [x] Backward compatible (single component viewing still works)
- [x] Clean code under 150 lines per file
- [x] Proper error handling throughout

---

## Testing Commands

```bash
# Build and install
make release-local

# Test non-streaming mode
stigmer server logs --all --follow=false --tail 20

# Test streaming mode
stigmer server logs --all -f

# Test error logs
stigmer server logs --all --stderr --follow=false

# Test backward compatibility
stigmer server logs -c workflow-runner
stigmer server logs --component server --stderr

# Check help
stigmer server logs --help
```

## Files Modified/Created

### Created
- `client-apps/cli/internal/cli/logs/types.go`
- `client-apps/cli/internal/cli/logs/parser.go`
- `client-apps/cli/internal/cli/logs/merger.go`
- `client-apps/cli/internal/cli/logs/streamer.go`

### Modified
- `client-apps/cli/cmd/stigmer/root/server_logs.go`

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

**Task Status**: ✅ COMPLETE  
**Next Steps**: Update documentation (Task 4) or continue to Task 3
