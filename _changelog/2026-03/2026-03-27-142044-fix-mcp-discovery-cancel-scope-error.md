# Fix MCP Discovery Cancel Scope RuntimeError

**Date**: March 27, 2026

## Summary

Fixed the `RuntimeError: Attempted to exit cancel scope in a different task than it was entered in` that caused the `DiscoverMcpServerCapabilities` Temporal activity to fail on every attempt. The fix replaces an `asyncio.wait_for()` + `AsyncExitStack` pattern with `asyncio.timeout()` + direct session context manager, aligning with the proven pattern already established in graphton's `mcp_manager.py`. Also upgraded `langchain-mcp-adapters` from 0.1.14 to 0.2.2.

## Problem Statement

MCP server discovery was completely broken — the activity failed on every attempt (retried 5 times) with an anyio cancel scope violation. This prevented any MCP server from being discovered after registration.

### Pain Points

- Every `DiscoverMcpServerCapabilities` invocation crashed during session teardown
- The Temporal workflow retried 5 times, each attempt failing identically
- The root cause was a known incompatibility between `asyncio.wait_for()` and anyio's cancel scope model (MCP Python SDK issues #79, #521, #577)
- The `langchain-mcp-adapters` version (0.1.14) was inconsistent with graphton's requirement (`>=0.2.0`)

## Solution

Replaced the problematic `AsyncExitStack` + `asyncio.wait_for()` pattern with `asyncio.timeout()` wrapping a direct `async with client.session()` context manager — the same ephemeral session pattern already used successfully in graphton's `list_mcp_resources`.

## Implementation Details

### `_connect_and_discover` rewrite

**Before** (broken):
```python
async with AsyncExitStack() as stack:
    session = await asyncio.wait_for(
        stack.enter_async_context(client.session(server_slug)),
        timeout=SESSION_INIT_TIMEOUT_SECONDS,
    )
```

`asyncio.wait_for()` manages task cancellation internally, which violates anyio's strict invariant that a cancel scope must be entered and exited in the same asyncio Task. When `AsyncExitStack` later calls `__aexit__`, the cancel scope exit happens in a different task context.

**After** (fixed):
```python
try:
    async with asyncio.timeout(SESSION_INIT_TIMEOUT_SECONDS):
        async with client.session(server_slug) as session:
            # discover tools and resources...
except TimeoutError:
    raise TimeoutError(...) from None
```

`asyncio.timeout()` (Python 3.11+) applies a deadline to the current task without crossing task boundaries. The direct `async with client.session()` pattern delegates the full subprocess lifecycle to `langchain-mcp-adapters` — spawning, MCP handshake, and clean teardown — which is what the library is designed to do.

### Dependency upgrade

Updated `langchain-mcp-adapters` from 0.1.14 to 0.2.2 in `requirements.txt`, resolving the version conflict with graphton's `pyproject.toml` (`>=0.2.0,<0.3.0`).

## Benefits

- MCP server discovery works again — the activity completes without cancel scope violations
- Code is simpler: removed `AsyncExitStack` and the `from contextlib import AsyncExitStack` import
- Aligned with the established pattern in graphton's `mcp_manager.py`, reducing cognitive overhead for maintainers
- Dependency version consistency between agent-runner and graphton

## Impact

- **Agent Runner**: `DiscoverMcpServerCapabilities` activity no longer crashes during session teardown
- **MCP Server Registration**: Users can register MCP servers and have their tools/resources discovered successfully
- **Dependency Graph**: `langchain-mcp-adapters` is now consistent across graphton and agent-runner

## Related Work

- MCP Python SDK issues: #79, #521, #577 (cancel scope violations with `AsyncExitStack`)
- MCP Python SDK PRs: #496, #559 (process termination and stream cleanup fixes, already included in `mcp==1.25.0`)
- Previous commit `6d5e8bcc`: discovery timeout and MCP subprocess security hardening

---

**Status**: Production Ready
**Timeline**: ~30 minutes
