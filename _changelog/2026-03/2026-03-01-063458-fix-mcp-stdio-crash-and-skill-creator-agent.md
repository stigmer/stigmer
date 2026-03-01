# Fix MCP Stdio Crash and Skill-Creator Agent Design

**Date**: March 1, 2026

## Summary

Fixed a `BrokenResourceError` crash affecting all agents that use stdio-based MCP servers (e.g. `stigmer-mcp-server`) by switching from ephemeral per-call MCP client sessions to persistent connections managed by `AsyncExitStack`. Also redesigned the `skill-creator` agent to remove unnecessary MCP server dependencies that caused both failures and behavioral bloat.

## Problem Statement

Two issues were tangled together, both surfacing during `stigmer draft skill` execution:

### Pain Points

- **MCP stdio crash**: Every tool invocation spawned a brand new Go subprocess. The subprocess teardown raced with the `stdout_reader` background task, producing `BrokenResourceError` wrapped in an anyio `TaskGroup` exception. The user-facing error was the opaque "unhandled errors in a TaskGroup (1 sub-exception)" with no indication of root cause.
- **Agent doing unnecessary work**: The `skill-creator` agent had MCP server tools (`search`, `get_agent`, `get_skill`, etc.) it did not need. The agent dutifully followed its instructions to "Query Available Resources" before creating a skill, wasting a turn on a tool call that then crashed, killing the entire execution.
- **A previous plan** (`fix_mcp_stdio_crash_3c090721.plan.md`) correctly diagnosed the stdio issue and marked all todos as completed, but the fix was never applied to the codebase.

## Solution

### Part A: Persistent MCP Client Connections (Infrastructure)

Introduced `connect_mcp_client()` in `mcp_manager.py` that enters `async with MultiServerMCPClient(servers)` via a caller-provided `AsyncExitStack`. This keeps stdio subprocesses alive for the entire agent execution. The middleware (`McpToolsLoader`) owns the stack and closes it in `aafter_agent()`.

### Part B: Skill-Creator Agent Redesign (Design)

Removed `mcp_server_usages` entirely from the `skill-creator` agent. Cleaned up instructions to remove MCP-related workflow steps and principles. The agent now has exactly what it needs (the `skill-creator` skill) and nothing more.

### Part C: Actionable Error Messages

Added `_unwrap_exception()` to `tool_wrappers.py` that recursively extracts the first meaningful cause from `BaseExceptionGroup` wrappers. All three MCP tool invocation error handlers now surface the actual root cause.

## Implementation Details

### `mcp_manager.py`
- New `connect_mcp_client(servers, tool_filter, exit_stack)` -- enters the `async with` context on `MultiServerMCPClient` via the provided `AsyncExitStack`. Tools returned from `get_tools()` remain valid because the client stays open.
- Extracted shared logic into `_validate_inputs()` and `_filter_tools()`.
- Kept `load_mcp_tools()` as a backward-compatible ephemeral wrapper (safe for HTTP-only servers).

### `middleware.py`
- `McpToolsLoader` now holds `self._exit_stack: AsyncExitStack`.
- Both sync and async loading paths use `connect_mcp_client()` to establish persistent connections.
- `aafter_agent()` calls `self._exit_stack.aclose()` to cleanly shut down all MCP server connections/subprocesses.

### `tool_wrappers.py`
- Added `_unwrap_exception()` that recurses into `BaseExceptionGroup` to extract the actual root cause.
- Applied to all three MCP tool wrapper types: `create_tool_wrapper`, `create_approval_aware_tool_wrapper`, `create_lazy_tool_wrapper`.
- Cleaned up excessive diagnostic logging left from a debugging phase (promoted to `debug` level or removed).

### `skill-creator.yaml`
- Removed `mcp_server_usages` block entirely (was: `stigmer-mcp-server` with 5 tools).
- Removed MCP-related instruction paragraph and workflow step 2 ("Query Available Resources").
- Removed "Verify Before Referencing" key principle.
- Renumbered remaining workflow steps (6 -> 5).
- Added explicit instruction to read SKILL.md before beginning work.

## Benefits

- **All stdio MCP servers work**: Persistent connections eliminate the session teardown race.
- **Faster execution**: No redundant Go subprocess spawning per tool call (~365ms compilation overhead saved per invocation).
- **Clear error messages**: When MCP tools do fail, the user sees the actual cause instead of a TaskGroup wrapper.
- **Focused agent behavior**: The skill-creator agent no longer wastes turns on platform discovery it does not need.
- **Smaller system prompt**: Removing MCP-related instructions and tool descriptions saves tokens.

## Impact

- **All MCP-using agents** benefit from persistent connections (infrastructure fix).
- **`stigmer draft skill`** no longer crashes and the agent proceeds directly to skill creation.
- **Backward compatible**: `load_mcp_tools()` remains available; `agent.py` deferred loading path requires no changes.

## Related Work

- `fix_mcp_stdio_crash_3c090721.plan.md` -- the original (unapplied) diagnosis of the stdio crash
- `fix_mcp_server_ux_bugs_21398e76.plan.md` -- related MCP UX improvements

---

**Status**: Production Ready
**Timeline**: ~2 hours
