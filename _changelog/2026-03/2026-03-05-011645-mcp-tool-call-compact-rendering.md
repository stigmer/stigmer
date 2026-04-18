# MCP Tool Call Compact Rendering and Server Identity

**Date**: March 5, 2026

## Summary

MCP tool calls (search, get_mcp_server, etc.) were rendered using the legacy `*`-prefixed format with `│` gutter borders, making them visually indistinguishable from sub-blocks and hiding their inputs and outputs. This overhaul gives every unknown/MCP tool the same `●` bullet compact format used by built-in tools, adds input argument display, output previews, and propagates the originating MCP server slug end-to-end so the CLI can render qualified names like `planton/search`.

## Problem Statement

When MCP tool calls appeared in a CLI session, users could not understand what happened. The calls were visually nested inside preceding read blocks due to the legacy gutter format, their input arguments were invisible, and their outputs were truncated or absent.

### Pain Points

- **Visual nesting ambiguity**: MCP tool calls rendered with `│` gutters looked like sub-content of the preceding tool call rather than top-level actions
- **Hidden inputs**: No way to see what arguments were passed to MCP tools -- critical for debugging and understanding agent behavior
- **Missing outputs**: Tool results were either absent or shown as opaque blobs without truncation or formatting
- **No server identity**: All MCP tools showed bare names (e.g., `search`) with no indication of which MCP server provided them, causing confusion when multiple servers expose tools with the same name

## Solution

Two-phase approach: Phase 1 delivers immediate CLI rendering improvements with no backend dependency. Phase 2 adds end-to-end MCP server identity propagation through proto, backend, and CLI.

## Implementation Details

### Phase 1: CLI Compact Rendering for Unknown/MCP Tools

**`toolrender/format.go`** -- New `formatInputArgs` helper that converts a `map[string]interface{}` into sorted, indented `key: "value"` lines. String values longer than 80 characters are truncated with `…`; values exceeding 200 characters show a `<large content>` placeholder. A configurable `max` parameter caps the number of displayed arguments.

**`toolrender/render_compact.go`** -- New `renderCompactUnknown` renderer produces the compact format:
- `●` bullet with tool name (and `server/` prefix when available)
- Duration metadata in dim style
- Indented input arguments via `formatInputArgs`
- Indented output preview (up to 3 lines) or `✗` error indicator for failed calls

Routing updated in both `RenderCompact` and `RenderCompactRunning` to send unknown tools through the new compact renderer instead of the legacy `renderUnknown`/`RenderWithBadge` path.

**`toolrender/render_approval.go`** -- `ApprovalQuestion` now shows a compact `key=value` summary for unknown tools instead of the bare tool name. `ExpandedApprovalHeader` renders `server/tool` when `ServerName` is populated. `renderApprovalUnknown` displays formatted input arguments below the header.

**`toolrender/render.go`** -- `ToolCallInfo` struct gains a `ServerName` field for the MCP server slug.

### Phase 2: End-to-End MCP Server Identity

**`apis/.../api.proto`** -- Added `string mcp_server_slug = 17` to the `ToolCall` message. Documents the field's semantics: empty for built-in sandbox tools, populated by the worker from the `mcp_tools_config` reverse lookup.

**`backend/.../status_builder.py`** -- `_handle_tool_start_event` now calls `self._approval_config.get_mcp_server_for_tool(tool_name)` to resolve the server slug and assigns it to the `ToolCall` proto.

**`client-apps/cli/.../run_display_tools.go`** -- `convertToolCall` populates `ServerName` from `tc.GetMcpServerSlug()`. Proto stubs regenerated to include the new field.

### Tests

Comprehensive test coverage added to `render_compact_test.go`:
- Basic compact format verification for unknown tools
- Input argument display with sorted keys and truncation
- Output preview rendering with line limiting
- Error display with `✗` indicator
- Server name prefix in header (`server/tool` format)
- Gutter-wrap compatibility with the new compact format
- Edge cases: no args, no result, empty server name

Existing approval tests updated in `render_approval_test.go` to reflect the new `formatApprovalArgs` output format.

## Benefits

- **Visual consistency**: MCP tools now share the same `●` bullet compact format as built-in tools, eliminating the nesting confusion
- **Input transparency**: Users can immediately see what arguments the agent passed to each MCP tool
- **Output visibility**: Truncated result previews show what came back, with clear error indicators for failures
- **Server disambiguation**: Qualified `server/tool` names (e.g., `planton/search`) prevent confusion when multiple MCP servers are configured
- **Forward compatibility**: The `ServerName` field and proto `mcp_server_slug` are ready for future UI features like server-colored badges

## Impact

- **End users**: MCP tool calls are now readable and informative in the CLI, matching the quality of built-in tool rendering
- **Debugging**: Input/output visibility makes it far easier to diagnose agent behavior involving MCP tools
- **Multi-server setups**: Users with multiple MCP servers can distinguish which server handled each call
- **Approval flow**: MCP tool approval prompts now show argument summaries, helping users make informed allow/deny decisions

## Related Work

- Builds on the compact rendering framework from `2026-03-04-013241-compact-read-tool-rendering.md` and `2026-03-04-030351-other-tools-compact-rendering.md`
- Connects to the approval UX work in `2026-03-03-084312-expandable-hitl-approval-content.md`
- The `mcp_server_slug` field complements the MCP tool error resilience work in `2026-03-03-100453-mcp-tool-error-resilience.md`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
