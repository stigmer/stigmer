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
| `--component` | `-c` | `server` | Component to view (`server` or `agent-runner`) |
| `--stderr` | | `false` | Show error logs instead of stdout |

**⚠️ Behavior Change**: As of January 2026, `stigmer server logs` streams by default (Kubernetes-style). This shows existing logs first, then streams new ones continuously. Use `--follow=false` if you only want to view existing logs without streaming.

## Components

Stigmer server consists of two main components:

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
# Show last 100 lines of errors from both components
stigmer server logs --stderr --tail 100
stigmer server logs -c agent-runner --stderr --tail 100
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
temporal.log         # Temporal server logs (if managed)
```

You can also access these files directly if needed:

```bash
# Manual log access (before stigmer server logs existed)
tail -f ~/.stigmer/data/logs/daemon.err
```

## Tips and Tricks

### Watch for Specific Patterns

```bash
# Use grep to filter logs
stigmer server logs --tail 1000 | grep ERROR
stigmer server logs -f | grep -i "workflow"
```

### Compare Server and Agent Logs

```bash
# Terminal 1: Server logs
stigmer server logs -f --stderr

# Terminal 2: Agent logs  
stigmer server logs -f -c agent-runner --stderr
```

### Save Logs for Bug Reports

```bash
# Capture logs to file
stigmer server logs --tail 1000 > server-logs.txt
stigmer server logs --stderr --tail 1000 > server-errors.txt
stigmer server logs -c agent-runner --stderr > agent-errors.txt
```

### Clear Old Logs

If logs get too large:

```bash
# Stop server first
stigmer server stop

# Clear logs
rm ~/.stigmer/data/logs/*.{log,err}

# Restart
stigmer server
```

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
- `stigmer server restart` - Restart the server

---

*"You can't debug what you can't see."* - With `stigmer server logs`, now you can see everything.
