# MCP Server Library Card Grid — Icon Fix, Layout Improvements, and Connect Dialog

**Date**: April 13, 2026

## Summary

Fixed three issues with the MCP server library card grid: icons not rendering despite data being present in MongoDB, server names being indistinguishable due to CSS truncation, and the plus button navigating to the detail page instead of enabling inline connect. Root cause analysis via live database and Kubernetes pod logs revealed the Java cloud search extractor was dropping `iconUrl` from search results, while the Go OSS extractor was already correct.

## Problem Statement

The MCP server library card grid (shipped earlier today) had three user-facing issues visible in live testing:

### Pain Points

- **Icons missing**: 19 of 55 MCP servers had `spec.iconUrl` populated in MongoDB, but all cards showed generic kind icons. Live investigation confirmed the Java cloud `McpServerSearchableExtractor.toSearchResult()` did not map `iconUrl` to `SearchResult` — the Go OSS extractor was already correct
- **Names indistinguishable**: All 55 MCP server names are slug-format (`mcp-server-github`, `mcp-server-slack`), and CSS `truncate` collapsed them all to "mcp-server..." making every card look identical. The "Public" badge competed for horizontal space in the same row
- **Plus button redundant**: The per-card plus button called `navigateToDetail()` — identical to clicking the card body. Users expected it to enable connecting (entering credentials / OAuth) without leaving the list
- **34 seedpack files missing `icon_url`**: Only 19 of 53 vendor MCP server YAML files had `icon_url` set

## Solution

Four-part fix spanning both repositories (stigmer OSS and stigmer-cloud), the React SDK, the Console, and the seedpack:

1. **Java extractor parity** — Added `setIconUrl` to both `McpServerSearchableExtractor` and `AgentSearchableExtractor` in stigmer-cloud, matching the Go OSS extractors
2. **Card layout** — Replaced `truncate` with `line-clamp-2` for names, moved `VisibilityBadge` to the card footer
3. **Connect dialog** — New `McpServerConnectDialog` SDK component for inline connect from the library grid
4. **Seedpack icons** — Added `icon_url` to all 34 remaining MCP server YAML files

## Implementation Details

### Java Cloud Search Extractors (stigmer-cloud)

Added the missing `iconUrl` mapping to `SearchResult` in both extractors:

- `McpServerSearchableExtractor.java`: `.setIconUrl(mcpServer.hasSpec() ? mcpServer.getSpec().getIconUrl() : "")`
- `AgentSearchableExtractor.java`: `.setIconUrl(agent.hasSpec() ? agent.getSpec().getIconUrl() : "")`

The Go OSS extractors (`mcpserver_extractor.go`, `agent_extractor.go`) already had `IconUrl: mcp.GetSpec().GetIconUrl()` — this was a cloud-only gap.

### Card Layout (ResourceListView.tsx > DefaultResourceCard)

- **Name**: `truncate` (single-line ellipsis) replaced with `line-clamp-2 leading-snug` — names wrap up to 2 lines, showing the full slug
- **VisibilityBadge**: Moved from the name row to a footer position with `mt-auto`, eliminating horizontal competition with the name
- Internal component, non-breaking change for SDK consumers

### McpServerConnectDialog (New SDK Component)

New `McpServerConnectDialog` in `@stigmer/react` that opens as a modal when the plus button is clicked:

- Fetches the server via `useMcpServer`
- Determines auth mode via `useMcpServerCredentials` (manual, OAuth, or mixed)
- Renders `EnvVarForm` for missing credentials
- Handles OAuth sign-in via `useMcpServerOAuthConnect`
- Fires connect RPC via `useMcpServerConnect` for tool discovery
- Uses native `<dialog>` for accessibility (focus trap, Escape, backdrop)
- Exported from `@stigmer/react` for platform builders

### Console Integration (McpServerListPage)

- Plus button now opens `McpServerConnectDialog` instead of calling `navigateToDetail`
- Card body click still navigates to the full detail page
- `connectTarget` state tracks which server's dialog is open

### Seedpack Icons (34 files)

Added `icon_url` to all remaining MCP server seedpack YAML files. All 53 files now have icon URLs:
- SimpleIcons CDN (`cdn.simpleicons.org`) for most vendors — consistent SVG format
- Stigmer favicon for internal resources (sequential-thinking)

## Benefits

- Icons now render for all MCP servers that have `iconUrl` in the database (19 immediately, 53 after re-seed)
- Server names are fully readable — `mcp-server-github` vs `mcp-server-slack` are visually distinct
- Users can connect to an MCP server directly from the library grid without navigating away
- Platform builders get `McpServerConnectDialog` as a reusable SDK component
- Java/Go search extractor parity restored

## Impact

- **MCP Server library page**: Cards show branded icons, full names, and an inline connect flow
- **Agent library page**: Agent icons will also render (AgentSearchableExtractor fixed)
- **Platform builders**: New `McpServerConnectDialog` component available for embedding
- **Both editions**: Go OSS was already correct; Java cloud now matches

## Related Work

- [Library card grid layout](_changelog/2026-04/2026-04-13-171427-library-card-grid-layout.md) — Phase 1: card grid and icon containers
- [Search result icon_url](_changelog/2026-04/2026-04-13-174629-search-result-icon-url.md) — Phase 2: proto field, Go extractors, seedpack icons (19 files)
- This changelog completes Phase 3: cloud extractor fix, remaining seedpack icons, layout polish, connect dialog

---

**Status**: ✅ Production Ready
**Files Changed**: 40 (stigmer), 2 (stigmer-cloud)
