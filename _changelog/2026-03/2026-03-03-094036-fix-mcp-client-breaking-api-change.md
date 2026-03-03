# Fix MCP Client Breaking API Change in Graphton

**Date**: March 3, 2026

## Summary

Fixed a breaking runtime error in graphton's MCP tool loading caused by `langchain-mcp-adapters` 0.1.0+ removing async context manager support from `MultiServerMCPClient`. Replaced the deprecated pattern with per-server persistent sessions, preserving the original design intent of keeping stdio subprocesses alive across tool invocations.

## Problem Statement

Agent executions that configured MCP servers were failing immediately with `NotImplementedError` during tool initialization, cascading through the middleware and Temporal activity layers to produce a `FAILED` execution status.

### Pain Points

- `MultiServerMCPClient.__aenter__` raises `NotImplementedError` since `langchain-mcp-adapters` 0.1.0
- `connect_mcp_client()` in graphton still used the removed `async with` pattern via `AsyncExitStack.enter_async_context(client)`
- Every agent execution with MCP tools failed before reaching the first LLM call
- Error message was clear about the cause but the fix required understanding session lifecycle semantics

## Solution

Replaced the single `enter_async_context(client)` call with per-server `client.session(server_name)` calls, each registered on the caller's `AsyncExitStack`. Tools are loaded via `langchain_mcp_adapters.tools.load_mcp_tools(session)` bound to their persistent session, so each tool reuses the same connection rather than reconnecting per invocation.

## Implementation Details

**`mcp_manager.py` -- `connect_mcp_client()`**

Before (broken):
```python
client = MultiServerMCPClient(servers)
await exit_stack.enter_async_context(client)  # raises NotImplementedError
all_tools = await client.get_tools()
```

After (per-server persistent sessions):
```python
client = MultiServerMCPClient(servers)
all_tools: list[BaseTool] = []
for server_name in servers:
    session = await exit_stack.enter_async_context(
        client.session(server_name)
    )
    server_tools = await _lc_load_mcp_tools(session)
    all_tools.extend(server_tools)
```

**`test_mcp_manager.py`** -- Added 8 new tests in `TestConnectMcpClient` covering success paths (single/multi server), input validation, connection failures, partial filter match with warnings, and log output.

**`test_middleware.py`** -- Fixed stale mock targets that were patching `graphton.core.middleware.load_mcp_tools` (a name the middleware never imported) instead of `graphton.core.middleware.connect_mcp_client`. Also fixed 3 tests that had a latent `run_until_complete` conflict inside async test functions.

## Benefits

- MCP tool loading works again with `langchain-mcp-adapters` 0.1.14
- Persistent sessions preserved for stdio-transport servers (subprocess stays alive for entire agent execution)
- Function signature unchanged -- no caller modifications needed
- Middleware tests now actually mock the correct function, making them reliable
- 8 new tests covering the previously-untested `connect_mcp_client` function

## Impact

- **Agent Runner**: All agent executions that configure MCP servers can run again
- **Graphton library**: `connect_mcp_client()` uses the recommended `langchain-mcp-adapters` 0.1.0+ API
- **Test suite**: 42/42 MCP-related tests pass; no regressions in existing tests

## Related Work

- `langchain-mcp-adapters` 0.1.0 changelog (removed `MultiServerMCPClient` context manager)
- Graphton MCP middleware lifecycle (`McpToolsLoader` in `middleware.py`)

---

**Status**: Production Ready
