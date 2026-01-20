# Stigmer Server Logs

The `stigmer server logs` command provides Kubernetes-like log access for the Stigmer server daemon.

## Quick Reference

```bash
# View recent server logs (last 50 lines)
stigmer server logs

# Stream logs in real-time (like tail -f)
stigmer server logs --follow

# View error logs (stderr)
stigmer server logs --stderr

# View agent-runner logs
stigmer server logs --component agent-runner

# Combine options
stigmer server logs -f -c agent-runner --stderr --tail 100
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
| `--follow` | `-f` | `false` | Stream logs in real-time (like `tail -f`) |
| `--tail` | `-n` | `50` | Number of recent lines to show |
| `--component` | `-c` | `server` | Component to view (`server` or `agent-runner`) |
| `--stderr` | | `false` | Show error logs instead of stdout |

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
| `stigmer server logs` | `kubectl logs pod-name` | `docker logs container` | View logs |
| `stigmer server logs -f` | `kubectl logs -f pod-name` | `docker logs -f container` | Stream logs |
| `stigmer server logs --tail 100` | `kubectl logs --tail=100 pod-name` | `docker logs --tail 100 container` | Last N lines |
| `stigmer server logs -c agent-runner` | `kubectl logs pod -c container` | N/A | Select component |

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
