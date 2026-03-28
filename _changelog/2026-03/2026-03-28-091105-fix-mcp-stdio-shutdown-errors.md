# Fix MCP Stdio Session Shutdown Errors in Agent Runner

**Date**: March 28, 2026

## Summary

Eliminated noisy `RuntimeError: Attempted to exit cancel scope in a different task` errors that appeared on every agent-runner pod restart when in-flight MCP stdio sessions were active. The fix combines a shutdown-time exception handler with explicit MCP session cleanup in the activity's finally block, and corrects a leaked exit-stack bug in sub-agent MCP sessions.

## Problem Statement

Every agent-runner pod restart (rolling deploy, OOM kill, scaling event) produced 100+ lines of `asyncio - ERROR` tracebacks when MCP stdio sessions were active during shutdown. The errors were cosmetic — shutdown completed successfully — but they polluted production logs and masked real issues.

### Pain Points

- Pod restarts generated hundreds of lines of `RuntimeError` tracebacks in the agent-runner logs
- The errors originated from a known anyio structured concurrency limitation (MCP SDK issue #577, labeled P1, still open)
- Sub-agent MCP sessions had their `AsyncExitStack` leaked entirely — the middleware's `aafter_agent` cleanup hook was never wired into the sub-agent lifecycle

## Solution

Three-layer fix targeting different aspects of the problem:

1. **Shutdown error suppression** — Custom event-loop exception handler installed at SIGTERM time filters out the known `"closing of asynchronous generator"` messages, reducing log noise to a single DEBUG line
2. **Explicit MCP cleanup in activity finally block** — The `execute_graphton` activity now closes the MCP middleware's `AsyncExitStack` in its `finally` block (same asyncio task context), preventing orphaned generators when Temporal cancels an activity
3. **Sub-agent MCP middleware lifecycle fix** — `_create_subagent_mcp_tools` now returns the middleware alongside the tool wrappers, and `_transform_single_subagent` includes it in the sub-agent dict's `middleware` list so `aafter_agent` fires during normal execution

## Implementation Details

### Files Changed

| File | Change |
|------|--------|
| `backend/services/agent-runner/main.py` | Added `_make_shutdown_exception_handler()` and wired it into `shutdown_handler()` |
| `backend/libs/python/graphton/src/graphton/core/agent.py` | Tracks `mcp_middleware_ref` and attaches it as `_graphton_mcp_middleware` on the returned graph |
| `backend/services/agent-runner/worker/activities/execute_graphton.py` | Closes `_graphton_mcp_middleware._exit_stack` in the `finally` block before other cleanup |
| `backend/services/agent-runner/worker/activities/graphton/subagent_transformer.py` | `_create_subagent_mcp_tools` returns `(tools, middleware)` tuple; caller adds middleware to sub-agent dict |

### Key Design Decisions

- **No library upgrades** — The fix is entirely in application code, working around the known anyio limitation until MCP SDK #577 ships a fix upstream
- **Attribute attachment over return-type change** — The MCP middleware is attached as `_graphton_mcp_middleware` on the compiled graph rather than changing `create_deep_agent`'s return type, preserving backward compatibility
- **Defense in depth** — Even with the explicit cleanup, the shutdown exception handler remains as a safety net for any edge cases where cleanup cannot complete in time

## Benefits

- **Log noise eliminated**: 100+ lines of tracebacks per pod restart reduced to a single DEBUG line
- **Resource cleanup improved**: MCP stdio subprocesses are terminated deterministically during activity cancellation
- **Sub-agent leak fixed**: Sub-agent MCP sessions now clean up via the middleware lifecycle instead of leaking until GC
- **No behavioral change**: Agent executions complete identically; only shutdown cleanup is affected

## Impact

- **Agent Runner** (cloud and local): Cleaner shutdown logs, deterministic MCP subprocess cleanup
- **Graphton library**: `create_deep_agent` now exposes the MCP middleware on the returned graph for callers that need explicit lifecycle control
- **Sub-agent MCP sessions**: Previously leaked `AsyncExitStack` now participates in the middleware lifecycle

## Related Work

- MCP Python SDK issue [#577](https://github.com/modelcontextprotocol/python-sdk/issues/577) (P1, still open)
- MCP Python SDK PR [#1271](https://github.com/modelcontextprotocol/python-sdk/pull/1271) (fixed `streamable_http` only, not `stdio`)
- langchain-mcp-adapters issue [#254](https://github.com/langchain-ai/langchain-mcp-adapters/issues/254) (closed)

---

**Status**: ✅ Production Ready
