# Fix Daemon Port Mismatch (CLI → Server)

**Date**: 2026-01-20  
**Type**: Bug Fix  
**Impact**: Critical - Prevents CLI from connecting to server

## Summary

Fixed port mismatch between CLI and server: CLI was setting `STIGMER_PORT` but server was reading `GRPC_PORT`.

## Problem

After the logs command revealed the server was running successfully, the connection still failed:

```bash
$ stigmer apply
Error: Cannot connect to stigmer-server

$ stigmer server logs --stderr
9:09AM INF Stigmer Server started successfully port=8080
9:09AM INF Starting gRPC network server port=8080
```

The server was running on **port 8080** (its default), but the CLI daemon manager was trying to connect to **port 50051**.

## Root Cause

**Environment variable mismatch:**
- CLI daemon starter: Sets `STIGMER_PORT=50051`
- Server config loader: Reads `GRPC_PORT` (defaults to 8080)

The server never received the port configuration from the CLI.

## Solution

Changed daemon startup to set the correct environment variable:

```go
// Before:
cmd.Env = append(os.Environ(),
    fmt.Sprintf("STIGMER_DATA_DIR=%s", dataDir),
    fmt.Sprintf("STIGMER_PORT=%d", DaemonPort),  // ❌ Wrong variable
)

// After:
cmd.Env = append(os.Environ(),
    fmt.Sprintf("STIGMER_DATA_DIR=%s", dataDir),
    fmt.Sprintf("GRPC_PORT=%d", DaemonPort),     // ✅ Correct variable
)
```

## Files Modified

- `client-apps/cli/internal/cli/daemon/daemon.go` - Fixed environment variable name

## Testing

```bash
# Build
make build

# Start server (should use port 50051)
stigmer server

# Check logs confirm correct port
stigmer server logs | grep "port="
# Should show: port=50051

# Test connection
stigmer apply
# Should work now!
```

## How This Was Discovered

The new `stigmer server logs` command (added earlier today) made this bug obvious:

```bash
$ stigmer server logs --stderr
9:09AM INF Stigmer Server started successfully port=8080  # Wrong port!
```

Before the logs command existed, this would have been nearly impossible to debug.

## Related

- Depends on: #add-server-logs-command (same day)
- Fixes connection issues reported in original error.md

---

*"Good logging makes debugging trivial."* - This bug was found and fixed in minutes thanks to `stigmer server logs`.
