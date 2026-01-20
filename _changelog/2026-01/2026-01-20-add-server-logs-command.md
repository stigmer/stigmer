# Add `stigmer server logs` Command for Debugging

**Date**: 2026-01-20  
**Type**: Feature  
**Impact**: Developer Experience

## Summary

Added `stigmer server logs` command to view and stream logs from the Stigmer server daemon, similar to `kubectl logs`. This makes debugging server issues significantly easier.

## Problem

When the local backend daemon starts, its logs are hidden, making it impossible to debug connection failures or crashes. Users had to manually navigate to `~/.stigmer/data/logs/` and read log files, which is a poor experience.

## Solution

Implemented `stigmer server logs` command with streaming support:

```bash
# View last 50 lines (default)
stigmer server logs

# Stream logs in real-time (like kubectl logs -f)
stigmer server logs --follow

# View agent-runner logs
stigmer server logs --component agent-runner

# View error logs (stderr)
stigmer server logs --stderr

# Custom number of lines
stigmer server logs --tail 100

# Combined: stream agent-runner errors
stigmer server logs -f -c agent-runner --stderr
```

## Implementation

**Files Added:**
- `client-apps/cli/cmd/stigmer/root/server_logs.go` - Logs command implementation

**Files Modified:**
- `client-apps/cli/cmd/stigmer/root/server.go` - Added logs subcommand
- `client-apps/cli/COMMANDS.md` - Documentation

**Features:**
- Supports both stdout and stderr logs
- Can view logs for `server` or `agent-runner` components
- Streaming mode with `--follow` flag (like `tail -f`)
- Configurable number of recent lines with `--tail`
- Graceful handling of missing log files

## Usage Example

When debugging the connection error:

```bash
$ stigmer apply
Error: Cannot connect to stigmer-server

$ stigmer server logs --stderr
ℹ Showing last 50 lines from: /Users/suresh/.stigmer/data/logs/daemon.err

FATAL: [core] grpc: Server.RegisterService after Server.Serve
```

Now we can immediately see the root cause: services are being registered after the server has started.

## Testing

```bash
# Build and test
make build
./bin/stigmer server logs
./bin/stigmer server logs --stderr
./bin/stigmer server logs --component agent-runner
```

## Impact

**Positive:**
- ✅ Debugging is now intuitive and fast
- ✅ No more manual navigation to log files
- ✅ Stream logs in real-time like Kubernetes
- ✅ Users can share logs easily for support

**Next Steps:**
- Fix the gRPC initialization bug revealed by these logs
- Consider adding log filtering/grep capabilities
- Add timestamp filtering for large log files

## Related Issues

This command helped identify:
- Port mismatch: daemon runs on 8080, CLI expects 50051
- gRPC initialization ordering bug

---

*"You can't debug what you can't see."*
