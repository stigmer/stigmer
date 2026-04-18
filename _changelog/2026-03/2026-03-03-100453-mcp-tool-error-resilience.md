# MCP Tool Error Resilience: Complete the Unfinished Fix

**Date**: March 3, 2026

## Summary

MCP tool invocation errors (e.g. gRPC NotFound from a backend lookup) were crashing entire agent executions instead of letting the LLM self-correct. This completes the Feb 24 tool error resilience work -- platform tools were fixed then, but MCP tool wrappers were missed and still raised `RuntimeError` on any failure.

## Problem Statement

When an agent called an MCP tool like `get_mcp_server` and the backend returned gRPC `NotFound` (the resource does not exist yet), the entire execution crashed:

1. gRPC `NotFound` from backend
2. MCP server returns `CallToolResult` with `isError=true`
3. `langchain_mcp_adapters` raises `ToolException`
4. `tool_wrappers.py` catches it and re-raises as `RuntimeError`
5. LangGraph `ToolNode` only catches `ToolInvocationError` (pydantic) -- `RuntimeError` propagates
6. `execute_graphton.py` top-level handler sets `EXECUTION_FAILED`

A "resource not found" is an expected operational outcome, not a system error. The agent was checking whether an MCP server named "planton" existed -- it did not, and that is valid information the LLM needs to proceed with creating it. Instead, the session died.

### Pain Points

- Any MCP tool error (NotFound, PermissionDenied, Unavailable, etc.) killed the entire agent session
- The LLM never received the error message and had no opportunity to self-correct
- All prior progress in the execution was lost
- The Feb 24 fix addressed platform tools but left MCP tools with the same vulnerability

## Solution

Applied the same pattern established on Feb 24 for platform tools: catch exceptions and return enriched error strings instead of raising. This is also consistent with `AuthenticatedMcpToolNode`, which already implements this pattern.

## Implementation Details

### `tool_wrappers.py` (2 MCP wrapper functions updated)

Both `create_tool_wrapper` and `create_approval_aware_tool_wrapper` had their `except Exception` blocks changed from:
```python
except Exception as e:
    cause = _unwrap_exception(e)
    logger.error(f"MCP tool '{tool_name}' invocation failed: {cause}", exc_info=True)
    raise RuntimeError(f"MCP tool '{tool_name}' invocation failed: {cause}") from e
```

To:
```python
except Exception as e:
    cause = _unwrap_exception(e)
    logger.warning(f"MCP tool '{tool_name}' invocation failed: {cause}", exc_info=True)
    return enrich_error_message(tool_name, str(cause))
```

`ToolExecutionRejectedError` (from HITL approval) is unaffected -- it is raised before `ainvoke()` is reached.

### `error_hints.py` (MCP-specific recovery hints)

Added targeted recovery hints for:
- **gRPC errors**: Detected via "rpc error" / "grpc" patterns, with sub-hints for NotFound, PermissionDenied, Unauthenticated, and Unavailable
- **Platform entity lookups**: Detected via "not found" combined with "org", "slug", "server", or "environment"

These are distinct from the existing file/path "not found" hints and guide the LLM toward API-appropriate recovery strategies (e.g. "proceed with create" instead of "use ls or glob").

## Benefits

- Agent executions no longer crash on MCP tool errors
- The LLM receives the error with actionable recovery hints and can self-correct
- Consistent error handling across all tool categories (platform tools, MCP tools)
- Warning-level logs instead of error-level for operational failures

## Impact

- **Scope**: All MCP tools loaded via `create_tool_wrapper` or `create_approval_aware_tool_wrapper` -- every MCP server connected to every agent
- **Reliability**: gRPC NotFound, PermissionDenied, Unavailable, and other expected API failures no longer kill sessions
- **Observability**: Cleaner log levels -- `warning` for operational failures, `error` reserved for true system issues

## Related Work

- `_changelog/2026-02/2026-02-24-223911-tool-error-resilience.md` -- the original fix for platform tools
- `AuthenticatedMcpToolNode` -- already implements this pattern for per-request-auth MCP tools

---

**Status**: Production Ready
