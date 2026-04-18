# Fix MCP Server Slug Propagation for Early Tool Calls

**Date**: March 5, 2026

## Summary

MCP tool calls rendered with bare names (e.g., `get_mcp_server`) instead of qualified `server/tool` names (e.g., `planton/get_mcp_server`) because the early tool call creation path bypassed the `mcp_server_slug` assignment. This fix propagates the slug at early creation time and backfills it during reconciliation as a safety net.

## Problem Statement

The `mcp_server_slug` field was added to the `ToolCall` proto in Phase 2 of the MCP compact rendering work and was correctly wired end-to-end: backend assignment, CLI extraction, and compact renderer display. However, in streaming mode most tool calls flow through `_create_early_tool_call` (fired when the LLM emits a `tool_use` block, before `on_tool_start`), which never set the slug. The subsequent `_reconcile_early_tool_call` also skipped it, and after reconciliation `_handle_tool_start_event` returned early, bypassing the slug-setting code entirely.

### Pain Points

- **Bare MCP tool names**: Users saw `get_mcp_server` instead of `planton/get_mcp_server`, losing server context
- **Dead proto field**: `mcp_server_slug` was defined and documented but effectively unused for the dominant code path
- **Multi-server confusion**: When multiple MCP servers expose tools, bare names are ambiguous

## Solution

Two targeted changes in `status_builder.py` to close the data-flow gap, following the same lookup pattern already used by `_handle_tool_start_event`.

## Implementation Details

**`_create_early_tool_call`** -- Resolve `mcp_server_slug` via `approval_config.get_mcp_server_for_tool(tool_name)` before constructing the ToolCall, passing it into the constructor. This ensures the qualified name is visible from the very first render frame with no visual jank.

**`_reconcile_early_tool_call`** -- After updating args and clearing `is_streaming`, backfill `mcp_server_slug` if the existing ToolCall has an empty slug. The `if slug and not existing.mcp_server_slug` guard prevents overwriting a valid slug already set during early creation. This covers the edge case where `_approval_config` was unavailable at early creation time but available at reconciliation.

## Benefits

- **Qualified MCP tool names**: CLI now renders `planton/get_mcp_server` from the first render frame
- **Proto field fulfills its purpose**: `mcp_server_slug` is no longer dead weight on the dominant streaming code path
- **Multi-server clarity**: Users with multiple MCP servers can immediately see which server handles each tool call

## Impact

- **End users**: MCP tool calls display their server origin in the CLI, matching the intended UX from the Phase 2 design
- **No downstream changes needed**: Proto, CLI extraction, compact renderer, and approval renderer were already wired correctly

## Related Work

- Completes Phase 2 of `2026-03-05-011645-mcp-tool-call-compact-rendering.md` which added the `mcp_server_slug` field and CLI rendering support

---

**Status**: ✅ Production Ready
**Timeline**: Single session
