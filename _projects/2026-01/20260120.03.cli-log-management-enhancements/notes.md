# Notes: CLI Log Management Enhancements

**Project**: CLI Log Management Enhancements  
**Date**: 2026-01-20

---

## Design Philosophy

### Industry Best Practices

We're following patterns from established tools:

**Kubernetes** (`kubectl logs`):
- Streams by default
- Can view multiple containers
- Supports --tail and --follow
- Shows timestamps

**Docker** (`docker logs`):
- Rotates logs automatically
- Keeps multiple rotations
- Streams with -f flag
- Shows container prefix

**docker-compose** (`docker-compose logs`):
- Interleaves logs from multiple services
- Shows service name prefix
- Color-codes by service
- Sorts by timestamp

### Our Approach

Combine the best of all three:
- ✅ Stream by default (like Kubernetes)
- ✅ Rotate logs on restart (like Docker)
- ✅ Interleave multiple components (like docker-compose)
- ✅ Show component prefix (like docker-compose)

---

## Technical Decisions

### Decision 1: Timestamp-Based Rotation

**Options Considered**:
1. Sequential numbering (daemon.log.1, daemon.log.2)
2. Date-based (daemon.log.2026-01-20)
3. Timestamp-based (daemon.log.2026-01-20-231200)

**Chosen**: Option 3 (Timestamp-based)

**Reasoning**:
- Easy to identify when logs were created
- Natural sorting works correctly
- Multiple restarts per day don't conflict
- Cleanup by age is straightforward

**Format**: `YYYY-MM-DD-HHMMSS`  
**Example**: `daemon.log.2026-01-20-231200`

### Decision 2: Rotation on Restart Only

**Not** rotating based on file size or time interval.

**Reasoning**:
- Simpler implementation
- Predictable behavior
- Works for local development (main use case)
- Size-based rotation adds complexity

**Future Enhancement**: Could add size-based rotation if logs grow too large.

### Decision 3: Keep 7 Days of Logs

**Default**: Keep archived logs for 7 days, then auto-delete.

**Reasoning**:
- Enough history for debugging recent issues
- Prevents disk bloat
- Industry standard (Docker default)
- Can be configured if needed

**Future**: Make configurable via ~/.stigmer/config.yaml

### Decision 4: Interleaved vs Sequential Display

For `--all` flag, we chose **interleaved by timestamp**.

**Alternative**: Show all server logs, then all agent logs, then all workflow logs.

**Reasoning**:
- Better for troubleshooting (see interactions)
- Shows true timeline of events
- Matches docker-compose behavior
- More useful for debugging

---

## Implementation Challenges

### Challenge 1: Parsing Log Timestamps

**Problem**: Different components may format timestamps differently.

**Current Format** (zerolog):
```
2026/01/20 23:12:00 INFO Starting worker
```

**Solution**: Parse with consistent format string:
```go
layout := "2006/01/02 15:04:05"
timestamp, _ := time.Parse(layout, timestampStr)
```

**Edge Case**: Lines without timestamps (stack traces, continued lines)
- Inherit timestamp from previous line
- Or skip timestamp sorting for these lines

### Challenge 2: Streaming Multiple Files

**Problem**: Need to tail 3+ files simultaneously and merge outputs.

**Solution**: Goroutine per file + shared channel
```go
lines := make(chan LogLine, 100)

for _, file := range logFiles {
    go func(f string) {
        // Tail file, send lines to channel
    }(file)
}

// Print from channel (roughly in order)
for line := range lines {
    fmt.Println(line)
}
```

**Trade-off**: Lines may not be perfectly ordered in real-time, but close enough.

### Challenge 3: Large Log Files

**Problem**: Reading entire logs into memory for timestamp sorting.

**Solution**: Use streaming approach:
- For `--tail N`, only read last N lines from each file
- Use ring buffer to keep last N lines
- Only parse timestamps for displayed lines

**Implementation**: 
```go
func readLastNLines(file string, n int) []LogLine {
    // Read file backwards
    // Keep last N lines
    // Parse and return
}
```

---

## Code Architecture

### Module Structure

```
client-apps/cli/
├── cmd/stigmer/root/
│   └── server_logs.go          # Command definition, flag handling
├── internal/cli/
│   ├── daemon/
│   │   └── daemon.go           # Log rotation logic
│   └── logs/                   # NEW: Log utilities package
│       ├── rotation.go         # Rotation functions
│       ├── streaming.go        # Multi-file streaming
│       └── formatting.go       # Log line formatting
```

**New Package**: `internal/cli/logs/`

Centralizes log-related utilities:
- Log rotation
- Multi-file streaming
- Timestamp parsing
- Component prefixing

### Key Functions

**Rotation**:
```go
// In daemon.go, called at start
func rotateLogsIfNeeded(dataDir string) error

// In logs/rotation.go
func RotateLogFile(path string, timestamp time.Time) error
func CleanupOldLogs(dir string, keepDays int) error
```

**Streaming**:
```go
// In server_logs.go
func streamAllLogs(logDir string, opts LogOptions) error

// In logs/streaming.go
type LogLine struct {
    Timestamp time.Time
    Component string
    Line      string
}

func StreamMultipleFiles(files []string, ch chan<- LogLine) error
func MergeLogLines(lines []LogLine) []LogLine
```

---

## User Experience Considerations

### UX Goal: Make It Feel Natural

**For Kubernetes Users**:
- `stigmer server logs` ~ `kubectl logs pod -f`
- `stigmer server logs -c agent-runner` ~ `kubectl logs pod -c container`
- `stigmer server logs --all` ~ new feature they'll appreciate

**For Docker Users**:
- Logs rotate like Docker containers
- `--follow` streams like `docker logs -f`
- Multiple components like `docker-compose logs`

### Error Messages

Clear, actionable errors:

```bash
# No logs yet
❌ "Log file does not exist"
✅ "Log file does not exist: ~/.stigmer/data/logs/daemon.log
    Server might not have been started yet. Run: stigmer server start"

# Invalid component
❌ "Invalid component: foo"
✅ "Invalid component: 'foo'. Valid options: server, agent-runner, workflow-runner"

# No permission
❌ "Permission denied"
✅ "Cannot read log file: Permission denied
    Log file: ~/.stigmer/data/logs/daemon.log
    Try: chmod 644 ~/.stigmer/data/logs/*.log"
```

### Progress Indicators

For operations that take time:

```bash
# Rotating logs
stigmer server restart
⏳ Rotating logs...
✅ Logs rotated: 6 files archived
⏳ Starting services...
```

---

## Future Enhancements

### Potential Features (Not In Scope)

1. **Colored Output**
   - Color-code by component (like docker-compose)
   - Use different colors for ERROR, WARN, INFO

2. **Log Levels Filtering**
   ```bash
   stigmer server logs --level ERROR
   stigmer server logs --level INFO,WARN
   ```

3. **Search/Filter**
   ```bash
   stigmer server logs --grep "workflow"
   stigmer server logs --since "5m ago"
   ```

4. **Export/Archive**
   ```bash
   stigmer server logs --export archive.tar.gz
   ```

5. **Remote Log Viewing**
   - View logs from remote stigmer-server
   - Useful for production debugging

6. **Size-Based Rotation**
   - Rotate when log exceeds 100MB
   - Configurable threshold

7. **Structured JSON Logs**
   - Output logs as JSON for machine parsing
   - Better for log aggregation tools

### Configuration File

Future: Add to `~/.stigmer/config.yaml`:
```yaml
logs:
  rotation:
    enabled: true
    keepDays: 7
    maxSize: 100MB  # Future: size-based rotation
  display:
    showTimestamp: true
    colorize: true
    format: "text"  # or "json"
```

---

## Testing Strategy

### Unit Tests

Test individual functions:
- `RotateLogFile()` - creates archived file correctly
- `CleanupOldLogs()` - deletes old files
- `ParseLogTimestamp()` - parses various formats
- `FormatLogLine()` - adds component prefix

### Integration Tests

Test end-to-end flows:
- Start server → generate logs → restart → verify rotation
- View logs with --all → verify interleaving
- Stream with --all → verify real-time updates

### Manual Testing

Test user workflows:
- Developer debugging workflow execution
- Operator troubleshooting server issues
- User checking if server is running

---

## Metrics/Observability

Track log management operations:
```
log_rotation_count              # How many rotations
log_rotation_duration_seconds   # How long it takes
log_files_archived_total        # Files archived
log_files_cleaned_total         # Old files deleted
log_view_requests_total         # Usage of logs command
```

Not implementing now, but good to think about.

---

## Questions & Answers

**Q: Should we compress archived logs?**  
A: Not in initial version. Adds complexity. Can add later with gzip if needed.

**Q: What if log directory doesn't exist?**  
A: Auto-create it. Fail gracefully with clear error if can't.

**Q: Should --all be the default?**  
A: No. Single component view is simpler and faster for most cases.

**Q: What about Windows compatibility?**  
A: Not a priority. Stigmer targets macOS/Linux for now.

**Q: Should we show color in component prefixes?**  
A: Nice to have, but adds complexity. Keep for future enhancement.

---

## Related Work

**Similar in Other Projects**:
- Docker log rotation: Uses json-file driver with max-size/max-file options
- Kubernetes: Uses node-level log rotation (logrotate)
- systemd: journalctl with --vacuum-time and --vacuum-size

**Inspiration**:
- `docker-compose logs` - Beautiful multi-service display
- `stern` (Kubernetes) - Tail multiple pods at once
- `multitail` - Terminal tool for tailing multiple files

---

## Timeline

**Rough Estimates**:
- Task 1 (Rotation): 1-2 hours
- Task 2 (Unified Viewing): 2-3 hours  
- Task 3 (Clear Flag): 30 min
- Task 4 (Documentation): 1 hour
- Task 5 (Testing): 1 hour

**Total**: ~6-8 hours for complete feature

**Could be split into**:
- Session 1: Tasks 1, 4 (rotation + docs) - 2-3 hours
- Session 2: Tasks 2, 3, 5 (viewing + testing) - 3-4 hours
