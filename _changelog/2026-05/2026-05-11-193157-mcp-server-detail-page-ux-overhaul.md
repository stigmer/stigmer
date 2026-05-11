# MCP Server Detail Page UX Overhaul

**Date**: May 11, 2026

## Summary

Redesigned the MCP server detail page in the React SDK to surface previously hidden HTTP configuration fields (headers, query parameters) and to make tools and policies usable at scale with search, scroll, and progressive disclosure.

## Problem Statement

The MCP server detail view was missing critical fields from the HTTP server specification and became unusable as the number of discovered tools and policies grew.

### Pain Points

- HTTP headers (e.g. `Authorization: Bearer ${KEY}`) were stored in the spec but never displayed or editable in the UI — users had no way to view or manage them.
- HTTP query parameters suffered the same omission.
- Saving the URL or timeout for an HTTP server silently dropped any existing headers and query parameters because the save callback constructed a partial object.
- Tools and policies were rendered as flat, non-searchable lists. With 200+ tools and 100+ policies, scanning the list was impractical.
- Tool input schemas were entirely hidden — users had no way to inspect a tool's parameter contract.
- Policy approval badges were a lone icon with no label, offering no textual indication of what they signified.

## Solution

All changes were made inside the SDK component (`McpServerDetailView.tsx`) so both the desktop and web clients receive the improvements automatically — no client-app changes required.

## Implementation Details

### HTTP Headers and Query Parameters

- Introduced `currentHttpConfig` memo that captures the full HTTP configuration (URL, headers, query params, timeout) from the server type, ensuring all fields are available for consistent round-trip saves.
- All `saveMcpField("http", ...)` calls now spread `currentHttpConfig` before overriding the target field, preventing accidental field erasure.
- Created `HttpKeyValueSubsection` — a reusable sub-component that switches between a read-only key-value list and the existing `InlineEditKeyValue` component based on edit state.
- Environment variable placeholders (`${VAR_NAME}`) in header values are highlighted with a themed badge via `renderHeaderValue`.
- Headers and query params sections are conditionally rendered: always visible when editable, hidden when read-only and empty.

### Tools Tab Redesign

- Added a search input with clear button that filters tools by name or description (case-insensitive substring match).
- Wrapped tool list in a `max-h-96` scrollable container.
- Each tool row is now a collapsible disclosure button; clicking reveals the tool's `inputSchema` as prettified JSON in a scrollable `<pre>` block.
- A "schema" badge on each row indicates whether a tool has an input schema.
- Result count dynamically shows "N of M" when filtering is active.

### Policies Tab Redesign

- Added a search input with clear button that filters policies by tool name or message across both pinned and auto-classified groups.
- Wrapped policy groups in a scrollable container with dynamic result count.
- Replaced the bare shield icon on each policy with a labeled `requires approval` badge for clarity.

### Supporting Changes

- Added `SearchIcon`, `CloseIcon`, and `ChevronIcon` inline SVG components following the file's existing icon pattern.

## Benefits

- **Completeness**: HTTP headers and query parameters are now first-class UI citizens — viewable, editable, and preserved during saves.
- **Scalability**: Search and scroll make the tools and policies tabs practical for MCP servers with hundreds of entries.
- **Discoverability**: Expandable tool schemas let users inspect parameter contracts without leaving the detail view.
- **Clarity**: Labeled approval badges remove ambiguity from the policies tab.
- **Zero client-app changes**: SDK-first architecture means desktop and web clients benefit automatically.

## Impact

- All users viewing or editing MCP servers in either the desktop or web client.
- Eliminates a data-loss bug where saving URL or timeout would erase HTTP headers and query parameters.
- Reduces friction for operators managing large MCP servers (200+ tools).

## Related Work

- `2026-05-11-151040-rename-mcp-server-definitions.md` — MCP server definition renaming (same day)

---

**Status**: ✅ Production Ready
