# Fix MCP Server Discovery Failure and Clean Up Subprocess Output

**Date**: February 25, 2026

## Summary

Fixed the MCP server capability discovery failing with "exit status 1" during `stigmer server` startup, and eliminated noisy Go toolchain / subprocess log output from the user's terminal. The root cause was a combination of silent error swallowing and the MCP server treating normal client disconnects as fatal errors.

## Problem Statement

When running `stigmer server`, the bootstrap discovery phase always failed for the built-in `stigmer-mcp-server`, printing:

```
go: downloading github.com/stigmer/stigmer/mcp-server v0.0.17
go: github.com/stigmer/stigmer/mcp-server@v0.0.17 requires go >= 1.25.6; switching to go1.25.7
time=... level=INFO msg="mcp-server-stigmer starting" transport=stdio
time=... level=INFO msg="tools registered" count=11 ...
time=... level=INFO msg="resource templates registered" count=5 ...
time=... level=INFO msg="mcp-server-stigmer stopped"
exit status 1
⚠ Discovery failed for 1 MCP server(s)
```

### Pain Points

- The MCP server exited with code 1 but the actual error was never logged — `main()` called `os.Exit(1)` without printing the error from `mcpserver.Run()`
- The MCP SDK's `Server.Run()` returns an error (EOF / broken pipe) when the discovery client disconnects after querying, which is completely normal behavior for a one-shot discovery session
- Go toolchain download messages, version switching logs, and internal slog output were piped directly to the user's terminal via `cmd.Stderr = os.Stderr`

## Solution

A layered fix across the MCP server process, the shared discovery library, and the CLI:

1. **Make errors visible** — log the actual error before `os.Exit(1)` so failures are diagnosable
2. **Handle normal shutdown gracefully** — recognize EOF, broken pipe, and context cancellation as clean client disconnects rather than fatal errors
3. **Capture subprocess stderr** — buffer stderr output instead of piping to terminal; include it in error messages only when discovery fails
4. **Improve CLI output** — add a user-friendly status message before discovery starts

## Implementation Details

### MCP Server Error Logging (`mcp-server/cmd/mcp-server-stigmer/main.go`)

Added `fmt.Fprintf(os.Stderr, "fatal: %v\n", err)` before `os.Exit(1)` so the actual error is always visible in subprocess stderr.

### Normal Shutdown Handling (`mcp-server/pkg/mcpserver/run.go`)

Added `isNormalShutdown()` that recognizes:
- `context.Canceled` / `context.DeadlineExceeded`
- `io.EOF` / `io.ErrUnexpectedEOF` / `io.ErrClosedPipe`
- `syscall.EPIPE`
- String-level fallbacks for MCP SDK errors that wrap EOF without using Go's error chain

When `ServeStdio()` returns a normal-shutdown error, the server now exits with code 0 instead of code 1.

### Subprocess Stderr Capture (`backend/libs/go/mcpdiscovery/`)

- `CreateTransport()` now accepts an `io.Writer` for stderr (nil defaults to `io.Discard`)
- `Discover()` captures stderr into a `bytes.Buffer` and attaches it to error messages via `withStderr()` — only when discovery actually fails
- On success, the buffer is simply discarded

### CLI Output (`client-apps/cli/cmd/stigmer/root/server.go`)

Added `"Discovering MCP server capabilities..."` status message before the discovery call.

## Benefits

- **Discovery now succeeds** — the MCP server exits cleanly (code 0) after the discovery client disconnects
- **Clean terminal output** — no more Go toolchain download noise, version switching messages, or internal server logs in the user's terminal
- **Diagnosable failures** — when discovery genuinely fails, the subprocess stderr is included in the error message
- **Better UX** — users see a clear status message during discovery instead of raw subprocess output

## Impact

- **End users**: Cleaner `stigmer server` startup output; discovery succeeds reliably
- **Developers**: Actual errors are now visible for debugging; stderr capture provides diagnostic context
- **MCP server**: Can be used as a one-shot discovery target without false failure reports

## Related Work

- Bootstrap discovery integration (2026-02-25)
- MCP server tool discovery (PR #47)

---

**Status**: ✅ Production Ready
