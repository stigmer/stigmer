# CLI: Stream Logs by Default (Kubernetes-style Behavior)

**Date**: 2026-01-20  
**Scope**: `client-apps/cli`  
**Type**: Enhancement (User-facing behavior change)

## Summary

Changed `stigmer server logs` to stream logs by default (like `kubectl logs -f`), showing existing logs first and then streaming new ones in real-time. This provides a better user experience aligned with Kubernetes CLI patterns.

## Problem

The previous behavior had UX issues:

1. **Non-intuitive default**: `stigmer server logs` only showed last 50 lines without streaming
   - Users had to explicitly use `--follow` to stream logs
   - Kubernetes users expected streaming by default (like `kubectl logs -f`)

2. **Missing context when streaming**: `stigmer server logs --follow` would:
   - Seek to end of file immediately
   - Only show NEW logs from that point forward
   - Miss all existing log content
   - Users lost context of what happened before they ran the command

3. **Inconsistent with kubectl**: Kubernetes does this well:
   ```bash
   kubectl logs pod-name           # Shows all logs + streams
   kubectl logs pod-name --tail=50 # Shows last 50 + streams
   kubectl logs pod-name --follow=false # Only shows logs, no stream
   ```

## What Changed

### 1. Default Behavior Changed

**Before**: Show last 50 lines only (no streaming)
```bash
stigmer server logs              # Last 50 lines only
stigmer server logs --follow     # Stream new logs only (no existing logs)
```

**After**: Stream logs by default (Kubernetes-style)
```bash
stigmer server logs              # Last 50 lines + stream new logs
stigmer server logs --tail=100   # Last 100 lines + stream new logs
stigmer server logs --tail=0     # ALL existing logs + stream new logs
stigmer server logs --follow=false # Last 50 lines only (no streaming)
```

### 2. Flag Defaults Updated

```diff
- cmd.Flags().BoolVarP(&follow, "follow", "f", false, "...")
+ cmd.Flags().BoolVarP(&follow, "follow", "f", true, "Stream logs in real-time (like kubectl logs -f)")

- cmd.Flags().IntVarP(&lines, "tail", "n", 50, "Number of recent lines to show (when not following)")
+ cmd.Flags().IntVarP(&lines, "tail", "n", 50, "Number of recent lines to show before streaming (0 = all lines)")
```

### 3. `streamLogs()` Function Rewritten

**Before**: Seeked to end of file, only showed new logs
```go
func streamLogs(logFile string) error {
    file, _ := os.Open(logFile)
    file.Seek(0, io.SeekEnd)  // ❌ Skip all existing logs
    // Stream new logs only
}
```

**After**: Shows existing logs first, then streams new ones
```go
func streamLogs(logFile string, tailLines int) error {
    file, _ := os.Open(logFile)
    
    // Phase 1: Show existing logs (last N lines or all)
    if tailLines == 0 {
        // Show all existing logs
        for scanner.Scan() {
            fmt.Println(scanner.Text())
        }
    } else {
        // Show last N lines using circular buffer
        lines := make([]string, 0, tailLines)
        for scanner.Scan() {
            // Circular buffer logic
        }
    }
    
    // Phase 2: Stream new logs as they arrive
    reader := bufio.NewReader(file)
    for {
        line, err := reader.ReadString('\n')
        // Stream new content
    }
}
```

### 4. Help Text Updated

Updated command help to reflect new default behavior:

```diff
Long: `View logs from the Stigmer server daemon.

-By default, shows stdout logs from stigmer-server.
-Use --stderr to view error logs instead.
-Use --component to select which component (server or agent-runner).
-Use --follow to stream logs in real-time (like kubectl logs -f).`,
+By default, streams logs in real-time (like kubectl logs -f).
+Use --follow=false to disable streaming and only show recent logs.
+Use --tail to limit how many existing lines to show before streaming (default: 50).
+Use --stderr to view error logs instead of stdout.
+Use --component to select which component (server or agent-runner).`,
```

## Implementation Details

### Circular Buffer for Last N Lines

When `--tail=N`, uses a circular buffer to efficiently show last N lines:

```go
lines := make([]string, 0, tailLines)
for scanner.Scan() {
    line := scanner.Text()
    if len(lines) < tailLines {
        lines = append(lines, line)
    } else {
        // Shift and append (circular buffer)
        lines = append(lines[1:], line)
    }
}
```

**Efficiency**: 
- Memory: O(N) where N = tail lines
- Time: O(total_lines) single pass
- No need to read file twice or seek backwards

### Two-Phase Streaming

1. **Phase 1 (Existing Logs)**:
   - Reads file from beginning using `bufio.Scanner`
   - Collects last N lines (or all if `--tail=0`)
   - Prints collected lines
   - Scanner leaves file position at end

2. **Phase 2 (New Logs)**:
   - Gets current position with `file.Seek(0, io.SeekCurrent)`
   - Creates new `bufio.Reader` for streaming
   - Polls for new lines with 100ms sleep
   - Handles file truncation/rotation

### File Rotation Handling

Detects if log file was truncated/rotated:

```go
stat, _ := file.Stat()
newPos, _ := file.Seek(0, io.SeekCurrent)
if stat.Size() < newPos {
    // File was truncated, seek to beginning
    file.Seek(0, io.SeekStart)
    reader = bufio.NewReader(file)
    currentPos = 0
}
```

## Usage Examples

### Default (Last 50 + Stream)
```bash
$ stigmer server logs
ℹ Streaming logs from: /Users/suresh/.stigmer/data/logs/daemon.log (showing last 50 lines)
ℹ Press Ctrl+C to stop

[Last 50 lines printed]
[Then streams new logs as they arrive]
```

### Show All Existing Logs + Stream
```bash
$ stigmer server logs --tail=0
ℹ Streaming logs from: /Users/suresh/.stigmer/data/logs/daemon.log (showing all existing logs)
ℹ Press Ctrl+C to stop

[All existing logs printed]
[Then streams new logs as they arrive]
```

### Show Last 10 Lines + Stream
```bash
$ stigmer server logs --tail=10
ℹ Streaming logs from: /Users/suresh/.stigmer/data/logs/daemon.log (showing last 10 lines)
ℹ Press Ctrl+C to stop

[Last 10 lines printed]
[Then streams new logs as they arrive]
```

### No Streaming (Old Behavior Available)
```bash
$ stigmer server logs --follow=false
ℹ Showing last 50 lines from: /Users/suresh/.stigmer/data/logs/daemon.log

[Last 50 lines printed, then exits]
```

### Workflow Runner Logs
```bash
$ stigmer server logs --component=workflow-runner
ℹ Streaming logs from: /Users/suresh/.stigmer/data/logs/workflow-runner.log (showing last 50 lines)
ℹ Press Ctrl+C to stop

[Workflow runner logs streamed]
```

### Error Logs
```bash
$ stigmer server logs --stderr
ℹ Streaming logs from: /Users/suresh/.stigmer/data/logs/daemon.err (showing last 50 lines)
ℹ Press Ctrl+C to stop

[Error logs streamed]
```

## Benefits

### 1. Better UX (Kubernetes-aligned)
- ✅ Streaming by default (expected behavior)
- ✅ Shows context first (existing logs), then streams
- ✅ Consistent with `kubectl logs -f` patterns
- ✅ Users don't lose log context

### 2. Flexible Control
- ✅ `--tail=N` controls how much history to show
- ✅ `--tail=0` shows all existing logs
- ✅ `--follow=false` disables streaming if needed
- ✅ Default (50 lines) balances context vs noise

### 3. Debugging Efficiency
- ✅ See recent context immediately
- ✅ Catch new logs as they happen
- ✅ Single command for most debugging needs
- ✅ No need to remember to add `--follow`

## Breaking Changes

⚠️ **Behavior change for existing users**:

**Before**: `stigmer server logs` would show 50 lines and exit  
**After**: `stigmer server logs` shows 50 lines and streams (waits for Ctrl+C)

**Migration**: Users who want old behavior can use `--follow=false`:
```bash
stigmer server logs --follow=false  # Old behavior
```

**Why acceptable**: 
- New behavior is objectively better UX
- Aligned with industry standard (kubectl)
- Old behavior still available via flag
- Streaming is what users expect when debugging

## Files Changed

```
client-apps/cli/cmd/stigmer/root/server_logs.go
```

**Changes**:
- Flag defaults: `follow=true`, updated help text for `tail`
- Help text: Updated to reflect new default behavior
- `streamLogs()`: Rewritten to show existing logs first, then stream
- Added `tailLines` parameter to `streamLogs()`
- Implemented circular buffer for last N lines
- Improved file position tracking

## Testing

**Manual testing performed**:

1. ✅ Default streaming (`stigmer server logs`)
   - Shows last 50 lines
   - Streams new logs
   - Ctrl+C stops cleanly

2. ✅ Custom tail (`stigmer server logs --tail=10`)
   - Shows last 10 lines correctly
   - Streams new logs after

3. ✅ Show all (`stigmer server logs --tail=0`)
   - Shows all existing logs
   - Streams new logs after

4. ✅ No streaming (`stigmer server logs --follow=false`)
   - Shows last 50 lines only
   - Exits immediately

5. ✅ Component selection (`stigmer server logs --component=workflow-runner`)
   - Streams workflow-runner logs correctly

6. ✅ Error logs (`stigmer server logs --stderr`)
   - Streams error logs correctly

## Related Issues

**Original UX problem**: User noticed two issues:
1. Default behavior didn't stream (had to remember `--follow`)
2. When streaming, previous logs were not shown (no context)

**Kubernetes comparison**: User correctly identified that kubectl does this better:
- `kubectl logs pod-name` shows existing + streams
- Stigmer should do the same

## Future Enhancements (Not Implemented)

Potential improvements for future:

1. **Timestamps**: Add `--timestamps` flag to show log timestamps
2. **Since**: Add `--since=5m` to show logs from last N minutes
3. **Color coding**: Highlight ERROR/WARN/INFO levels
4. **Component auto-detection**: Smart detection if only one component running
5. **Multi-component**: Stream both server and workflow-runner simultaneously

## Documentation Impact

**User-facing change**: CLI behavior changed significantly

**Documentation needed**:
- ✅ Help text updated (inline in command)
- ⚠️ Getting started guide may need update if it shows `stigmer server logs` examples
- ⚠️ CLI reference docs should mention new default behavior

## Conclusion

This change brings Stigmer CLI in line with Kubernetes patterns, providing better UX for users debugging local server issues. The streaming-by-default behavior with context (existing logs first) is more intuitive and reduces friction during development and troubleshooting.

**Key takeaway**: Sometimes the best UX is to follow what users already know (kubectl patterns).
