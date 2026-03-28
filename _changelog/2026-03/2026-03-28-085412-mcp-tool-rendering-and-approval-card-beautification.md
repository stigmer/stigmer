# MCP Tool Rendering & Approval Card Beautification

**Date**: March 28, 2026

## Summary

Two complementary improvements to the execution viewer in `@stigmer/react`: MCP tool calls now render with structured, human-readable formatting instead of raw JSON, and the HITL approval card for file tools (write/edit) now shows the same rich content preview as the post-execution expanded view — eliminating the jarring raw `{"path": "...", "content": "..."}` dump that confused users.

## Problem Statement

The execution viewer had two distinct UX gaps that degraded the monitoring experience for both Stigmer Console users and platform builders embedding `<MessageThread />`:

### Pain Points

- **MCP tool calls dumped as raw JSON**: Tools originating from MCP servers (e.g., `apply_mcp_server`, `get_agent`) were categorized as `"unknown"` and rendered using `GenericToolDetail` — a flat JSON blob for arguments and result. No visual distinction from built-in tools, no structured formatting, no content-block extraction.
- **Approval card showed technical field names**: When a Write tool required HITL approval, the `ApprovalCard` displayed the entire `argsPreview` JSON under a generic "Arguments" label — including raw field names like `path` and `content`. Meanwhile, the *same* tool call rendered beautifully after execution via `FileToolDetail` with a file icon, clickable path, and a labeled "Content" block.
- **MCP result format inconsistency**: MCP tool results often arrived as content-block arrays (`[{"type":"text","text":"..."}]`) or Python repr strings (single-quoted dicts), neither of which the generic renderer handled.
- **Backend did not handle list-type tool results**: The status builder's `_extract_tool_result_content` method in the agent-runner did not handle `list` results from MCP tools, falling through to the `str()` fallback and producing noisy output.

## Solution

### 1. MCP Tool Category & Dedicated Renderer

Added `"mcp"` as a first-class `ToolCategory` in `tool-categories.ts`. When `resolveToolCategory` receives a tool name that is not in the built-in map *and* has a non-empty `mcpServerSlug`, it returns the `"mcp"` category with a human-readable label derived from `humanizeToolName()` (e.g., `apply_mcp_server` becomes "Apply MCP Server").

Created `McpToolDetail` — a dedicated detail renderer that replaces the raw JSON dump:

- **Arguments**: Scalar values render in a key-value grid; complex values collapse into labeled JSON blocks.
- **Results**: Parsed through `parseMcpResult()` which handles MCP content-block arrays, embedded JSON, and Python repr artifacts before rendering.
- **Metadata**: Shows the MCP server slug alongside the humanized tool name.

### 2. Approval Card Beautification

Extracted the content-extraction logic into a shared `extractWriteContentFromPreview()` function in `tool-categories.ts` (scanning the same field names as the post-execution `extractWriteContent`). Made `FileArgsPreview` category-aware:

- **Write/Edit**: Extracts content body, displays it in a collapsible "Content" block — matching the `FileToolDetail` experience.
- **Read/Delete**: Shows only the file path with icon and link — no content preview needed.

### 3. Backend List Result Handling

Added `list` handling to `StatusBuilder._extract_tool_result_content` in the agent-runner. MCP tools that return content-block arrays now have their text extracted cleanly; other lists are JSON-serialized.

## Implementation Details

### New files

| File | Purpose |
|------|---------|
| `sdk/react/src/execution/McpToolDetail.tsx` | MCP-specific tool detail renderer with structured args/result formatting |

### Modified files

| File | Change |
|------|--------|
| `sdk/react/src/execution/tool-categories.ts` | Added `"mcp"` category, `humanizeToolName()`, `extractWriteContentFromPreview()` |
| `sdk/react/src/execution/ApprovalCard.tsx` | Category-aware `FileArgsPreview` with `CollapsibleCodePreview` for write/edit content |
| `sdk/react/src/execution/ToolCallDetail.tsx` | Integrated `McpToolDetail` via `CategoryRenderer` switch, pass `mcpServerSlug` to `resolveToolCategory` |
| `sdk/react/src/execution/ToolCallItem.tsx` | Added `McpPlugIcon`, pass `mcpServerSlug` to `resolveToolCategory` |
| `sdk/react/src/execution/ToolCallGroup.tsx` | Pass `mcpServerSlug` to `resolveToolCategory` in summary formatting |
| `sdk/react/src/execution/index.ts` | Export `McpToolDetail`, `parseMcpResult`, `humanizeToolName` |
| `sdk/react/src/index.ts` | Re-export new MCP detail types from barrel |
| `backend/services/agent-runner/worker/activities/graphton/status_builder.py` | Handle `list` type in `_extract_tool_result_content` |
| `seedpack/mcp-servers/mcp-server-stigmer.yaml` | Bump MCP server version to v0.0.52 |

## Benefits

- **Consistent approval experience**: Write/edit approval previews now match the post-execution expanded view — file path with icon + labeled content block instead of raw JSON.
- **MCP tool visibility**: MCP tools are visually distinguished with a plug icon, show their server origin prominently, and render structured arguments instead of opaque JSON blobs.
- **Content-block parsing**: MCP results that arrive as `[{"type":"text","text":"..."}]` arrays are automatically extracted and, when the text itself is JSON, pretty-printed.
- **SDK-first**: All rendering improvements are in `@stigmer/react`. Platform builders embedding `ApprovalCard` or `ToolCallDetail` get both improvements automatically.

## Impact

- **Direct users**: Cleaner execution monitoring for both built-in and MCP tool calls. Approval decisions can be made with the same content clarity as post-execution review.
- **Platform builders**: The `ApprovalCard` and `McpToolDetail` components, along with the `parseMcpResult` utility, are exported and available for custom thread implementations.
- **Backward-compatible**: No prop or API changes to existing components. The rendering improvements are internal to the component implementations.

## Related Work

- HITL flow simplification (PR #98) — established the pending approval projection model
- Platform capabilities gating — deployment-mode-aware resource availability

---

**Status**: ✅ Production Ready
