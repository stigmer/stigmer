# Stigmer Server Logs

The `stigmer server logs` command provides Kubernetes-like log access for the Stigmer server daemon.

## Quick Reference

```bash
# Stream logs in real-time (default, like kubectl logs -f)
# Shows last 50 lines + streams new logs
stigmer server logs

# Show all existing logs + stream new logs
stigmer server logs --tail=0

# Only show last 50 lines (no streaming)
stigmer server logs --follow=false

# View error logs (stderr) with streaming
stigmer server logs --stderr

# View agent-runner logs with streaming
stigmer server logs --component agent-runner

# View workflow-runner logs with streaming
stigmer server logs --component workflow-runner

# Combine options
stigmer server logs -f -c agent-runner --stderr --tail 100
```

## How It Works

When you run `stigmer server logs`, it operates in two phases (Kubernetes-style):

1. **Phase 1 - Existing Logs**: Shows recent logs (last 50 lines by default, or specify with `--tail`)
2. **Phase 2 - Live Streaming**: Continuously streams new log lines as they're written

This gives you context (what happened before) while keeping you updated (what's happening now).

```bash
# Default: Show last 50 lines + stream new logs
$ stigmer server logs
ℹ Streaming logs from: ~/.stigmer/data/logs/daemon.log (showing last 50 lines)
ℹ Press Ctrl+C to stop

[Last 50 lines of existing logs printed here]
[Then waits and streams new logs as they arrive]
^C  # Press Ctrl+C to stop
```

**To disable streaming** and only view existing logs:
```bash
stigmer server logs --follow=false
```

## Common Debugging Workflows

### Debugging Connection Failures

When `stigmer apply` fails with "Cannot connect to stigmer-server":

```bash
# Check if server is running
stigmer server status

# View server error logs
stigmer server logs --stderr

# Stream logs while reproducing issue
stigmer server logs --follow --stderr
```

### Debugging Agent Execution Issues

When AI agents fail or behave unexpectedly:

```bash
# View agent-runner logs
stigmer server logs --component agent-runner

# Stream agent errors in real-time
stigmer server logs -f -c agent-runner --stderr
```

### Debugging Workflow Execution Issues

When workflows fail during execution:

```bash
# View workflow-runner logs
stigmer server logs --component workflow-runner

# Stream workflow errors in real-time
stigmer server logs -f -c workflow-runner --stderr
```

### Monitoring Server Health

Keep an eye on server activity:

```bash
# Stream all server output
stigmer server logs --follow

# Watch for errors
stigmer server logs --follow --stderr
```

## Command Options

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--follow` | `-f` | `true` | Stream logs in real-time (like `kubectl logs -f`). Use `--follow=false` to disable. |
| `--tail` | `-n` | `50` | Number of recent lines to show before streaming (`0` = all existing logs) |
| `--component` | `-c` | `server` | Component to view (`server`, `agent-runner`, or `workflow-runner`) |
| `--stderr` | | `false` | Show error logs instead of stdout |

**⚠️ Behavior Change**: As of January 2026, `stigmer server logs` streams by default (Kubernetes-style). This shows existing logs first, then streams new ones continuously. Use `--follow=false` if you only want to view existing logs without streaming.

## Components

Stigmer server consists of three main components:

### `server` (default)
The main stigmer-server daemon that handles:
- gRPC API requests
- Database operations
- Workflow management
- Session handling

**Log files:**
- `~/.stigmer/data/logs/daemon.log` - Standard output
- `~/.stigmer/data/logs/daemon.err` - Error output

### `agent-runner`
The Python agent execution runtime that handles:
- AI agent execution
- LLM interactions
- Temporal workflow workers
- Tool execution

**Log files:**
- `~/.stigmer/data/logs/agent-runner.log` - Standard output
- `~/.stigmer/data/logs/agent-runner.err` - Error output

### `workflow-runner`
The Go workflow execution runtime that handles:
- Workflow validation
- Workflow execution
- Temporal activity workers
- Task orchestration

**Log files:**
- `~/.stigmer/data/logs/workflow-runner.log` - Standard output
- `~/.stigmer/data/logs/workflow-runner.err` - Error output

## Examples

### Example 1: First-time Setup Debugging

```bash
# Start server
stigmer server

# Server starts but immediate error
# Check what went wrong:
stigmer server logs --stderr
```

Output reveals the issue:
```
FATAL: [core] grpc: Server.RegisterService after Server.Serve
```

### Example 2: Monitoring Agent Execution

```bash
# Terminal 1: Stream agent logs
stigmer server logs -f -c agent-runner

# Terminal 2: Run a workflow
stigmer apply
```

Watch the agent logs in real-time to see:
- Which tools are being called
- LLM requests and responses
- Execution progress
- Any errors or warnings

### Example 3: Finding Recent Errors

```bash
# Show last 100 lines of errors from all components
stigmer server logs --stderr --tail 100
stigmer server logs -c agent-runner --stderr --tail 100
stigmer server logs -c workflow-runner --stderr --tail 100
```

## Comparison with Other Tools

If you're familiar with these tools, here's how `stigmer server logs` compares:

| Stigmer | Kubernetes | Docker | Description |
|---------|-----------|--------|-------------|
| `stigmer server logs` | `kubectl logs -f pod-name` | `docker logs -f container` | Stream logs (default) |
| `stigmer server logs --follow=false` | `kubectl logs pod-name --follow=false` | `docker logs container` | View logs only (no streaming) |
| `stigmer server logs --tail=100` | `kubectl logs --tail=100 pod-name` | `docker logs --tail=100 container` | Last N lines + streaming |
| `stigmer server logs --tail=0` | `kubectl logs --tail=-1 pod-name` | `docker logs container` | All logs + streaming |
| `stigmer server logs -c agent-runner` | `kubectl logs pod -c container` | N/A | Select component |

**Note**: Stigmer now matches Kubernetes behavior - streaming is the default, showing existing logs first then tailing new ones.

## Log Locations

All logs are stored in: `~/.stigmer/data/logs/`

```bash
$ ls -l ~/.stigmer/data/logs/
daemon.log           # stigmer-server stdout
daemon.err           # stigmer-server stderr  
agent-runner.log     # agent-runner stdout
agent-runner.err     # agent-runner stderr
workflow-runner.log  # workflow-runner stdout
workflow-runner.err  # workflow-runner stderr
temporal.log         # Temporal server logs (if managed)
```

You can also access these files directly if needed:

```bash
# Manual log access (before stigmer server logs existed)
tail -f ~/.stigmer/data/logs/daemon.err
```

## Log Rotation

**As of January 2026**, Stigmer automatically rotates logs on server restart to prevent log bloat and provide clear session boundaries.

### How It Works

When you run `stigmer server restart`, existing logs are automatically archived with timestamps:

**Before restart:**
```bash
~/.stigmer/data/logs/
  daemon.log              (10 MB of accumulated logs)
  agent-runner.log        (5 MB of accumulated logs)
  workflow-runner.log     (8 MB of accumulated logs)
```

**After restart:**
```bash
~/.stigmer/data/logs/
  daemon.log              (fresh empty log for new session)
  agent-runner.log        (fresh empty log for new session)
  workflow-runner.log     (fresh empty log for new session)
  daemon.log.2026-01-20-150405          (previous session archived)
  agent-runner.log.2026-01-20-150405    (previous session archived)
  workflow-runner.log.2026-01-20-150405 (previous session archived)
```

### Archived Log Format

Archived logs use timestamp format: `filename.YYYY-MM-DD-HHMMSS`

**Example**: `daemon.log.2026-01-20-150405`
- **Date**: 2026-01-20 (January 20, 2026)
- **Time**: 15:04:05 (3:04:05 PM)
- **Session**: Server restart at this exact time

This makes it easy to:
- Identify when logs are from
- Find logs for a specific session
- Correlate with events or issues

### Retention Policy

**Automatic cleanup**: Archived logs older than **7 days** are automatically deleted on restart.

**Why 7 days?**
- Balances disk space with debugging needs
- Industry standard for development environments
- Sufficient window for investigating recent issues

### Working with Archived Logs

**View archived logs:**
```bash
# List archived logs
ls -lh ~/.stigmer/data/logs/*.log.*

# View specific archived session
cat ~/.stigmer/data/logs/daemon.log.2026-01-20-150405

# Search across archived logs
grep "ERROR" ~/.stigmer/data/logs/daemon.log.2026-01-20-*

# View recent archived session
ls -t ~/.stigmer/data/logs/daemon.log.* | head -1 | xargs cat
```

**Find logs from specific time period:**
```bash
# Find logs from January 20, 2026
ls ~/.stigmer/data/logs/daemon.log.2026-01-20-*

# Find logs from last restart
ls -t ~/.stigmer/data/logs/daemon.log.* | head -1
```

**Manually preserve important logs:**
```bash
# Before they're automatically deleted
cp ~/.stigmer/data/logs/daemon.log.2026-01-15-* ~/important-logs/
```

### Rotation Behavior

**What gets rotated:**
- All component logs (daemon, agent-runner, workflow-runner)
- Both stdout (`.log`) and stderr (`.err`) files
- Only non-empty files (empty files aren't archived)

**When rotation happens:**
- On `stigmer server restart` (automatic)
- On `stigmer server start` after a previous shutdown (automatic)

**What doesn't trigger rotation:**
- `stigmer server stop` (just stops, doesn't rotate)
- Normal server operation (logs append)
- Using `stigmer server logs` (read-only)

### Smart Rotation

Stigmer only rotates log files that have content:

```bash
# If daemon.log is empty, it stays as daemon.log (not archived)
# If daemon.log has logs, it becomes daemon.log.2026-01-20-HHMMSS
```

This prevents clutter from empty log files.

### Troubleshooting Log Rotation

**Archived logs missing:**
- Check if they're older than 7 days (automatically deleted)
- Verify server has been restarted (rotation only happens on restart)
- Check disk space (cleanup may have failed if disk full)

**Old logs not cleaned up:**
- Check file modification times: `ls -lt ~/.stigmer/data/logs/`
- Verify server restart actually completed successfully
- Check for permission issues in logs directory

**Rotation failed:**
- Check log output: `stigmer server logs | grep -i "rotate"`
- Rotation failures are non-fatal (server continues)
- Check permissions: `ls -la ~/.stigmer/data/logs/`

## Tips and Tricks

### Watch for Specific Patterns

```bash
# Use grep to filter logs
stigmer server logs --tail 1000 | grep ERROR
stigmer server logs -f | grep -i "workflow"
```

### Compare Component Logs

```bash
# Terminal 1: Server logs
stigmer server logs -f --stderr

# Terminal 2: Agent logs  
stigmer server logs -f -c agent-runner --stderr

# Terminal 3: Workflow logs
stigmer server logs -f -c workflow-runner --stderr
```

### Save Logs for Bug Reports

```bash
# Capture logs to file
stigmer server logs --tail 1000 > server-logs.txt
stigmer server logs --stderr --tail 1000 > server-errors.txt
stigmer server logs -c agent-runner --stderr > agent-errors.txt
stigmer server logs -c workflow-runner --stderr > workflow-errors.txt
```

### Clear Old Logs

**⚠️ Note**: As of January 2026, logs are automatically rotated on restart with 7-day cleanup. Manual clearing is rarely needed.

If you need to manually clear logs:

```bash
# Stop server first
stigmer server stop

# Option 1: Clear current logs only (keep archived)
rm ~/.stigmer/data/logs/*.{log,err}

# Option 2: Clear all logs including archived (CAREFUL!)
rm ~/.stigmer/data/logs/daemon.* ~/.stigmer/data/logs/agent-runner.* ~/.stigmer/data/logs/workflow-runner.*

# Restart server
stigmer server
```

**Tip**: Use `stigmer server restart` to archive logs instead of deleting them.

## Troubleshooting

### "Log file does not exist"

The component hasn't started yet or failed to start.

**Solution:**
```bash
# Start the server
stigmer server

# Check status
stigmer server status
```

### Logs Are Empty

The component started but hasn't logged anything yet, or logs are going elsewhere.

**Possible causes:**
- Server just started (wait a moment)
- Server crashed immediately (check PID with `stigmer server status`)
- Logs redirected to different location (check `STIGMER_DATA_DIR`)

### "Permission Denied"

The CLI can't read the log files.

**Solution:**
```bash
# Fix permissions
chmod 644 ~/.stigmer/data/logs/*.{log,err}
```

---

## Related Commands

- `stigmer server` - Start the server
- `stigmer server status` - Check server status
- `stigmer server stop` - Stop the server
- `stigmer server restart` - Restart the server (includes automatic log rotation)

---

*"You can't debug what you can't see."* - With `stigmer server logs`, now you can see everything.
