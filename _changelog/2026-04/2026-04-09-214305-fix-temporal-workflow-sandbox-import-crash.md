# Fix Temporal Workflow Sandbox Import Crash

**Date**: April 9, 2026

## Summary

Fixed a fatal startup crash in the Agent Runner caused by Temporal's workflow sandbox blocking transitive imports of `http.client` through the `langchain` / `requests` / `urllib3` dependency chain. The fix removes eager heavy imports from the `worker.mcp` package `__init__.py` and defers the `langchain_mcp_adapters` import in `daytona_mcp_client.py` to runtime, allowing the Temporal worker to validate workflow classes without triggering sandbox restrictions.

## Problem Statement

The Agent Runner pod was crash-looping on startup with a `RestrictedWorkflowAccessError` when Temporal attempted to validate the `stigmer/mcp-server/connect` workflow. The worker process could not register any activities, rendering the entire agent execution pipeline inoperable.

### Pain Points

- Agent Runner pod in `stigmer-prod` crash-looping with a fatal error on every restart
- No agent executions, MCP server discoveries, or tool approval classifications could run
- The error message (`Cannot access http.client.IncompleteRead.__mro_entries__ from inside a workflow`) pointed to a deep transitive import chain, not an obvious application bug

## Solution

The root cause was an import chain triggered during Temporal's workflow sandbox validation:

1. `ConnectMcpServerWorkflow` is defined in `discover_mcp_server.py`
2. That module imports from `worker.mcp.config_transformer` at the top level
3. Python executes `worker/mcp/__init__.py` when any submodule of the package is imported
4. `__init__.py` eagerly imported `DaytonaMCPClient` from `daytona_mcp_client`
5. `daytona_mcp_client.py` had a top-level import of `langchain_mcp_adapters.client.MultiServerMCPClient`
6. This cascaded through `langchain_core` → `requests` → `urllib3` → `urllib3.exceptions`, which defines a class inheriting from `http.client.IncompleteRead` — a module the Temporal workflow sandbox restricts

The fix breaks this chain at two independent points, following defense-in-depth:

1. **`worker/mcp/__init__.py`** — Removed the eager re-exports of `DaytonaMCPClient` and `daytona_stdio_client`. Every consumer already imports these directly from their submodules; the package-level re-exports were unused convenience aliases.

2. **`worker/mcp/daytona_mcp_client.py`** — Moved the `MultiServerMCPClient` import behind `TYPE_CHECKING` and deferred the runtime import into `__init__()` where the class is actually instantiated. This makes the module safe to import at the top level of any file, eliminating a latent footgun.

## Implementation Details

### `worker/mcp/__init__.py`

Removed two imports and their `__all__` entries:
- `from worker.mcp.daytona_mcp_client import DaytonaMCPClient`
- `from worker.mcp.daytona_transport import daytona_stdio_client`

Added a docstring note explaining why these are intentionally excluded and the correct import pattern for consumers.

### `worker/mcp/daytona_mcp_client.py`

- Moved `from langchain_mcp_adapters.client import MultiServerMCPClient` into the `TYPE_CHECKING` block (the file already had `from __future__ import annotations`, so type annotations work as strings)
- Changed `__init__` to do a conditional runtime import only when HTTP servers are present

### What stayed the same

- No workflow or activity logic changes
- No new dependencies or framework configuration
- No changes to `discover_mcp_server.py`, `worker.py`, `main.py`, or `graphton/setup.py`
- Lightweight re-exports (`config_transformer`, `placeholder_resolver`) remain in `__init__.py`

## Benefits

- Agent Runner starts successfully and registers all workflows and activities
- The `worker.mcp` package is now safe to import in any context (workflow sandbox, activity, test)
- Defense-in-depth: even if someone later adds a direct import of `daytona_mcp_client`, the deferred import prevents the sandbox crash

## Impact

- **Agent Runner**: Unblocks production — the service can start and process executions again
- **MCP connect flow**: `ConnectMcpServerWorkflow` and `DiscoverMcpServerWorkflow` register without error
- **Developer experience**: The docstring in `__init__.py` documents the constraint, preventing future regressions

---

**Status**: ✅ Production Ready
