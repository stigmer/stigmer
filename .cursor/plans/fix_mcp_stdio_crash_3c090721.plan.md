---
name: Fix MCP stdio crash
overview: Fix the `BrokenResourceError` crash when Graphton agents invoke stdio-based MCP tools by switching from per-call ephemeral sessions to persistent MCP client connections.
todos:
  - id: refactor-mcp-manager
    content: Refactor mcp_manager.py to support persistent client connections via async with MultiServerMCPClient
    status: completed
  - id: update-middleware-lifecycle
    content: Update middleware.py to manage persistent MCP client lifecycle (AsyncExitStack in _load_tools_async, cleanup in aafter_agent)
    status: completed
  - id: update-agent-deferred-path
    content: Update agent.py deferred loading path (nest_asyncio) to work with persistent client pattern
    status: completed
  - id: verify-and-test
    content: Verify the fix handles both stdio and HTTP transport servers correctly, and that cleanup is robust
    status: completed
isProject: false
---

# Fix MCP Stdio Tool Invocation Crash (BrokenResourceError)

## Root Cause

The crash occurs because `mcp_manager.py` creates `MultiServerMCPClient` **without** the `async with` context manager pattern. In `langchain_mcp_adapters`, this means every tool invocation spawns a **brand new stdio process** rather than reusing a persistent connection.

### The failing call chain:

```
agent.py creates McpToolsLoader middleware
  -> mcp_manager.py: MultiServerMCPClient(servers)  <-- NO async with!
  -> get_tools() spawns process #1, discovers tools, process exits (OK)
  -> tools are cached in middleware
  ...later at runtime...
  -> approval_wrapper calls mcp_tool.ainvoke()
  -> langchain_mcp_adapters spawns process #2 for this single call
  -> go run ... starts (365ms compilation overhead)
  -> MCP handshake completes
  -> Session teardown races with server response
  -> stdout_reader gets BrokenResourceError
  -> Agent execution crashes
```

### Evidence from the logs:

- Server process #2 lives only **12ms** after initialization (starts at `.865Z`, stops at `.878Z`)
- The server exits cleanly (EOF on stdin), meaning the **client side closed the pipe** before the gRPC round-trip for `search` could complete
- The `BrokenResourceError` at `mcp/client/stdio/__init__.py:162` confirms the session teardown raced with the `stdout_reader` background task

### The existing correct pattern (already in the codebase):

`[authenticated_tool_node.py](backend/libs/python/graphton/src/graphton/core/authenticated_tool_node.py)` line 198 uses the persistent pattern correctly:

```198:198:backend/libs/python/graphton/src/graphton/core/authenticated_tool_node.py
            async with MultiServerMCPClient(run_configs) as client:
```

But `[mcp_manager.py](backend/libs/python/graphton/src/graphton/core/mcp_manager.py)` line 89 does NOT:

```89:92:backend/libs/python/graphton/src/graphton/core/mcp_manager.py
        mcp_client = MultiServerMCPClient(servers)
        
        # Get all tools from all servers
        all_tools = await mcp_client.get_tools()
```

When `MultiServerMCPClient` is used **with** `async with`, tools returned from `get_tools()` reuse the persistent connection for all subsequent invocations. Without it, each `ainvoke()` creates an ephemeral session (fine for HTTP, fatal for stdio).

## Fix Strategy

Introduce persistent MCP client lifecycle management in the middleware layer, so that a single long-lived `MultiServerMCPClient` connection is maintained for the entire agent execution.

### Files to change:

1. `**[mcp_manager.py](backend/libs/python/graphton/src/graphton/core/mcp_manager.py)`** - Split into two functions:
  - `connect_and_load_mcp_tools()` - enters the `async with` context, returns client + filtered tools
  - Keep `load_mcp_tools()` as a backward-compatible wrapper if needed
  - The caller (middleware) owns the client lifecycle
2. `**[middleware.py](backend/libs/python/graphton/src/graphton/core/middleware.py)`** - Manage the persistent client:
  - Store the `MultiServerMCPClient` instance and an `AsyncExitStack` on `self`
  - `_load_tools_async()`: use `AsyncExitStack.enter_async_context()` to enter the `async with` and keep the connection alive
  - `aafter_agent()`: close the `AsyncExitStack` to cleanly shut down the persistent connection
  - The sync path (`_load_tools_sync`) also needs updating for the persistent pattern
3. `**[agent.py](backend/libs/python/graphton/src/graphton/core/agent.py)`** (lines 440-455) - The `nest_asyncio` deferred-loading path must also use the persistent connection pattern

### Key design constraint:

The persistent `MultiServerMCPClient` context must span from tool loading through the entire agent execution until `aafter_agent()`. This is achievable because the middleware lifecycle hooks (`abefore_agent` / `aafter_agent`) bracket the entire agent run.

### What stays the same:

- The Go MCP server code is correct (no changes needed)
- The tool wrappers (`tool_wrappers.py`) are correct -- they delegate to `mcp_tool.ainvoke()` which will now use the persistent connection
- The MCP server YAML config is correct
- HTTP transport MCP servers will also benefit (persistent HTTP connections are more efficient than per-call)

## Risks and considerations

- **Mixed transport types**: A single `MultiServerMCPClient` can hold both stdio and HTTP servers. The persistent pattern works for both.
- **Connection failure mid-execution**: If the stdio server crashes during agent execution, subsequent tool calls will fail. This is acceptable -- it would fail with the current code too, just differently.
- **Sync loading path**: The `_load_tools_sync()` path uses `loop.run_until_complete()`. The persistent client must be entered in the same event loop that will later invoke tools. The `nest_asyncio` path in `agent.py` already handles this.
- **Cleanup guarantee**: `AsyncExitStack` with `aafter_agent()` ensures the connection is closed even if the agent fails.

