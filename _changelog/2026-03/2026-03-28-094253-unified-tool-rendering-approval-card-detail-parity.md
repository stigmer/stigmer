# Unified Tool Rendering: Approval Card and Detail View Parity

**Date**: March 28, 2026

## Summary

Unified the tool-call rendering pipeline so that HITL approval cards and
post-execution detail views share a single rendering path for tool arguments.
Previously, the approval card and the expanded tool call in the history list
used separate, divergent implementations — resulting in visual inconsistencies
across shell, file, search, MCP, and generic tool types. The approval card now
mirrors the ToolCallItem layout: same category icons, same compact header row,
and identical argument rendering via a shared `ToolArgsView` dispatch component.

## Problem Statement

The approval card (pre-execution) and the tool call detail (post-execution)
rendered tool arguments through completely independent code paths. Both produced
*similar-looking* output, but the implementations had drifted apart in styling,
truncation limits, layout structure, and MCP tool classification.

### Pain Points

- The approval card had a multi-line header (`Approval required` / badge / message)
  while the tool call history used a compact single-line row (`[icon] Label primaryArg`)
- `CollapsibleCode` in the approval card used `max-h-48` while the detail view used
  `max-h-80` — subtle but visible difference
- MCP tools in the approval card were classified as "unknown" (dumped as raw JSON)
  because `mcpServerSlug` was not available on `PendingApproval`
- Three copies of `CollapsiblePre`, two copies of `FilePathIcon`, two copies of
  `formatJson` — scattered across `ToolCallDetail`, `McpToolDetail`, and `ApprovalCard`
- Adding a new tool category required changes in three separate files

## Solution

Introduced a layered extraction: shared rendering primitives at the bottom,
a unified args dispatch in the middle, and thin context-specific wrappers
(detail view, approval card) at the top.

## Implementation Details

### Proto + Backend (data layer)

- Added `mcp_server_slug` (field 8) to `PendingApproval` in `approval.proto`
- Updated Go projection (`compute.go`) to copy `McpServerSlug` from `ToolCall`
- Updated Java projection (`PendingApprovalComputer.java`) with the same field
- Added Java unit tests for MCP slug projection and empty-slug for built-in tools

### Shared Rendering Primitives (`tool-rendering-primitives.tsx`)

New file consolidating all duplicated UI atoms:
- `CollapsibleCode` — labeled code block with unified truncation (10 lines)
- `CollapsiblePre` — bare pre with caller-controlled styling
- `CollapsibleJsonBlock` — chevron-toggled JSON section
- `FilePathIcon`, `McpServerIcon` — shared SVG icons
- `formatJson`, `formatResult`, `isScalar`, `humanizeArgKey` — utilities

### Shared Args Dispatch (`ToolArgsView.tsx`)

New component that resolves the tool category from `toolName` + `mcpServerSlug`
and dispatches to the appropriate category-specific view:

| Category | Renderer | Visual |
|----------|----------|--------|
| shell | `ShellArgsView` | Terminal-style `$ command` block |
| read/write/edit/delete | `FileArgsView` | File icon + path + optional content |
| search/list | `SearchArgsView` | Pattern badge |
| mcp | `McpArgsPreview` | `McpMetadataRow` + `McpArgsView` scalar grid |
| unknown | `GenericArgsView` | Formatted JSON |

Both `ApprovalCard` and `ToolCallDetail` now call `<ToolArgsView>` for args
rendering — single code path, identical output.

### Approval Card Restructure

- Header row now matches `ToolCallItem` layout: `[CategoryIcon] Label  primaryArg  [elapsed] [clock]`
- Imports the same `CATEGORY_ICON` map from `ToolCallItem` for icon parity
- Uses `ToolArgsView` for the args body (same component as the detail view)
- Keeps contextual elements: approval message, sub-agent attribution, action buttons
- Warning/destructive border styling preserved for visual distinction

### ToolCallDetail / McpToolDetail Simplification

- All category renderers (shell, file, search, generic) now compose
  `MetadataRow` + `ToolArgsView` + result sections
- `McpToolDetail` replaced local copies of 6 components with imports from
  shared primitives; exported `McpArgsView` and `McpMetadataRow` for reuse
- Net reduction: ~150 lines removed from duplicated rendering code

## Benefits

- **Visual parity**: Approval cards and expanded tool calls render identical
  argument previews for all tool categories
- **MCP tools in approval**: MCP tools now show structured scalar grids and
  server metadata instead of raw JSON dumps in the approval card
- **Single rendering path**: Adding or modifying a tool category requires
  changes in one file (`ToolArgsView.tsx`) instead of three
- **Consistent truncation**: All collapsible blocks use the same 10-line
  threshold and the same `max-h-80` container across both contexts

## Impact

- **SDK consumers** (`@stigmer/react`): New exports `ToolArgsView`, `McpArgsView`,
  `McpMetadataRow`, and all shared primitives available for custom compositions
- **Backend** (Go + Java): `PendingApproval` now carries `mcp_server_slug`,
  requiring coordinated deployment of both services
- **Platform builders**: Can use `ToolArgsView` independently to render tool
  arguments in custom UIs outside the standard message thread

## Related Work

- Builds on `760a63b3` (MCP tool rendering and approval card beautification)
- Part of the HITL approval cleanup project (`20260327.01.hitl-approval-cleanup`)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
