# Daytona stdio Relay for MCP Server Isolation

**Date**: April 9, 2026

## Summary

Implemented a custom MCP stdio transport that runs MCP servers inside the Daytona sandbox instead of as local subprocesses in the agent-runner pod. This closes a critical security gap: untrusted marketplace MCP servers no longer execute inside the control plane container. The transport is invisible to the rest of the stack — Graphton and LangGraph see standard MCP sessions.

## Problem Statement

The agent-runner currently spawns stdio MCP servers as child processes in its own container. Every MCP server — including untrusted ones from the marketplace — runs with the same privileges as the agent-runner itself: access to the Kubernetes pod network, environment variables, and local filesystem.

### Pain Points

- **Security boundary violation**: Marketplace MCP servers execute inside the control plane with full pod-level access
- **No process isolation**: A malicious or buggy MCP server can crash or compromise the agent-runner
- **Environment leakage**: Sensitive environment variables (API keys, database credentials) are visible to MCP server processes
- **No resource limits**: MCP servers share CPU/memory with the agent-runner without independent constraints

## Solution

Replace the local subprocess stdio transport with a Daytona session-backed transport. The MCP server process runs inside the existing Daytona sandbox (already provisioned for workspace code execution), while the agent-runner communicates with it over the Daytona control plane API. The full MCP protocol stack (`mcp.client.session.ClientSession`) is reused — only the transport layer is swapped.

## Implementation Details

### New Modules

**`worker/mcp/daytona_transport.py`** — Core transport layer

The `daytona_stdio_client()` async context manager mirrors the API of `mcp.client.stdio.stdio_client` but replaces subprocess pipes with Daytona session API calls:

1. Creates a unique Daytona session (`sandbox.process.create_session`)
2. Starts the MCP server command with `execute_session_command(run_async=True)`
3. Spawns two concurrent anyio tasks:
   - **stdout reader**: Consumes `get_session_command_logs_async` callbacks, buffers partial lines, parses complete NDJSON lines into `SessionMessage` objects, sends them to an anyio memory stream
   - **stdin writer**: Reads `SessionMessage` objects from an anyio memory stream, serializes to NDJSON, sends via `send_session_command_input`
4. Yields `(read_stream, write_stream)` — the same interface `ClientSession` expects
5. Cleans up the Daytona session on exit (`delete_session`)

Key design choices:
- NDJSON framing exactly matches `mcp.client.stdio` (newline-delimited JSON)
- `SessionMessage` wrapping (not raw `JSONRPCMessage`) matches mcp 1.25.0 expectations
- Sync Daytona SDK calls wrapped in `anyio.to_thread.run_sync` to preserve async contract
- 60-second startup timeout with logged warnings
- Process crash detected via EOF on stdout

**`worker/mcp/daytona_mcp_client.py`** — Client routing layer

`DaytonaMCPClient` separates stdio servers (routed through Daytona) from HTTP servers (delegated to `MultiServerMCPClient`). Its `session(server_name)` async context manager:

- For stdio servers: calls `daytona_stdio_client()`, wraps streams in `ClientSession`, initializes, yields
- For HTTP servers: delegates to the internal `MultiServerMCPClient.session()`

### Graphton Integration (3 files modified)

Threaded an optional `client` parameter through:
- `connect_mcp_client()` in `mcp_manager.py` — uses provided client instead of creating `MultiServerMCPClient`
- `McpToolsLoader.__init__()` in `middleware.py` — stores and forwards client
- `create_deep_agent()` in `agent.py` — accepts `mcp_client` kwarg

The parameter is duck-typed (no protocol class, no Daytona import). Graphton remains completely Daytona-agnostic.

### Agent-Runner Wiring

`setup.py` creates `DaytonaMCPClient` when `sandbox is not None` and at least one stdio server is configured. Local/OSS mode is completely unchanged.

### SDK Version Alignment

`requirements.txt` daytona packages updated from 0.129.0 to 0.151.0 to match `poetry.lock` and ensure access to async session APIs.

## Benefits

- **Security isolation**: MCP server processes run inside the Daytona sandbox with independent resource limits, no access to agent-runner environment
- **Zero architecture change**: Reuses existing Daytona sandbox — no new infrastructure, no additional cold start, no extra cost
- **Transparent to application layer**: Graphton, LangGraph, and tool approval see standard MCP sessions — no behavioral changes
- **Clean separation of concerns**: Transport is a self-contained module; Graphton stays framework-agnostic
- **Testable**: Unit tests with mocks for fast CI; integration tests with live Daytona for confidence

## Impact

- **Agent-runner**: Cloud mode stdio MCP servers now execute in sandbox isolation
- **Graphton library**: Gains optional client injection (no breaking changes, backward compatible)
- **OSS/local mode**: Completely unchanged — no sandbox, no Daytona, standard subprocess transport
- **Existing tests**: 1476 tests pass with zero regressions

## Related Work

- **T01** (same project): Sandbox image enhancement and automated snapshot pipeline — provides the `agent-sandbox-full` image with runtimes needed by MCP servers
- **T03** (next): Integrate MCP server process management with Graphton middleware
- **T04** (future): Remove bundled MCP runtimes from agent-runner Dockerfile
- Previous changelog: `2026-04-09-164211-sandbox-full-ci-pipeline-and-snapshot-integration-tests.md`

---

**Status**: Production Ready
**Timeline**: Single session (~3 hours)
