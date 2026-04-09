# Task T02: Daytona stdio Relay for MCP Server Isolation

**Created**: 2026-04-09
**Status**: PENDING
**Estimated Effort**: 1 session
**Depends On**: T01 (sandbox image must have MCP runtimes)

## Objective

Build the core security component: a Daytona stdio relay that starts MCP server processes inside the Daytona sandbox and relays stdin/stdout via the Daytona session API, replacing the current local `subprocess.Popen` approach for cloud mode.

## Background

MCP stdio protocol requires a long-lived bidirectional pipe: the agent-runner sends JSON-RPC requests on stdin and reads JSON-RPC responses from stdout. Today this is a local subprocess. The relay moves this into the sandbox, using Daytona's session API primitives:

- `execute_session_command(session_id, SessionExecuteRequest(command=..., run_async=True))` -- start background process
- `send_session_command_input(session_id, command_id, data)` -- write to stdin
- `get_session_command_logs_async(session_id, command_id, on_stdout=...)` -- stream stdout via WebSocket

## Scope

### 1. Daytona stdio Relay Module

Create `worker/mcp/daytona_stdio_relay.py`:

- **`DaytonaStdioRelay`** class that manages a single MCP server process in the sandbox:
  - `start(sandbox, command, args, env)` -- create a Daytona session, run the MCP server command with `run_async=True`, subscribe to stdout via WebSocket
  - `send(data: str)` -- send JSON-RPC message to stdin via `send_session_command_input`
  - `receive() -> str` -- read the next JSON-RPC response from the stdout stream
  - `stop()` -- kill the process, delete the session
  - Handle newline-delimited JSON-RPC framing (buffer partial lines, split multi-line frames)

- **`DaytonaMultiServerRelay`** class that manages multiple MCP servers in the same sandbox:
  - Each MCP server gets its own Daytona session (separate session_id)
  - Provides a dict-like interface mapping server slugs to relays

### 2. JSON-RPC Framing Validation

The WebSocket stdout stream from Daytona may deliver data in chunks that don't align with JSON-RPC message boundaries. Handle:
- A single WebSocket frame containing multiple JSON-RPC lines
- A single JSON-RPC message spanning multiple WebSocket frames
- Build a line-based buffer that emits complete JSON-RPC messages

### 3. Lifecycle Management

- MCP servers must stay alive for the entire agent execution
- Handle sandbox auto-stop recovery: if sandbox was revived (STOPPED -> STARTED), MCP server processes are dead and must be restarted
- Clean shutdown: close WebSocket subscriptions, delete sessions on teardown
- Error handling: process crash detection, timeout on startup, graceful degradation

### 4. Integration Interface

The relay must present an interface that can replace the current `MultiServerMCPClient` stdio transport. Two approaches to evaluate:

**Approach A -- Custom transport**: Patch or wrap `langchain_mcp_adapters.MultiServerMCPClient` to use the Daytona relay instead of `subprocess.Popen` for stdio servers.

**Approach B -- In-sandbox HTTP bridge**: Deploy a small HTTP-to-stdio bridge script inside the sandbox. The bridge starts the MCP server as a subprocess and exposes it over streamable HTTP on localhost. The agent-runner connects via HTTP (no custom transport needed). Transform stdio configs to `"transport": "streamable_http"` pointing at the bridge URL.

Decision criteria: Approach A is simpler but couples to `langchain_mcp_adapters` internals. Approach B is cleaner architecturally but requires a bridge script in the sandbox image.

## Success Criteria

- [ ] Daytona stdio relay can start an MCP server in the sandbox and exchange JSON-RPC messages
- [ ] JSON-RPC framing works correctly (validated with a real MCP server like `@modelcontextprotocol/server-github`)
- [ ] Multiple MCP servers can run concurrently in the same sandbox
- [ ] Clean startup, steady-state operation, and shutdown
- [ ] Error handling for process crash, sandbox recovery, and timeout scenarios

## Files to Create/Modify

| Action | File |
|--------|------|
| Create | `backend/services/agent-runner/worker/mcp/daytona_stdio_relay.py` |
| Create | Tests for the relay |

## Key Technical Risks

1. **Latency**: HTTP/WebSocket round-trip adds ~5-50ms per MCP interaction vs sub-ms for local pipes. Acceptable for most MCP tool calls (which themselves make 100ms-5s API calls).
2. **Framing**: WebSocket `std_demux_stream` may add framing overhead. Needs real-world validation.
3. **Buffering**: Daytona may buffer stdout, delaying JSON-RPC response delivery. May need to configure unbuffered mode or flush signals.

## Notes

- The Daytona SDK `send_session_command_input` accepts a string (not bytes) -- JSON-RPC is text-based so this works
- `get_session_command_logs_async` uses WebSocket with `std_demux_stream` for stdout/stderr demuxing
- This module is sandbox-specific (cloud mode only). Local mode continues using `subprocess.Popen`
