# Add icon_url to SearchResult Proto, Backend Extractors, and Seedpack

**Date**: April 13, 2026

## Summary

Added `icon_url` as field 13 to the `SearchResult` proto, wired it through the Go backend search extractors, updated the React SDK card/list components to render per-resource icons, and seeded icon URLs for all 10 Stigmer system agents, the Stigmer MCP server, and 18 popular vendor MCP servers. This completes the Phase 2 work identified in the library card grid layout changelog.

## Problem Statement

The library card grid layout (shipped earlier today) introduced `DefaultResourceCard` with icon containers, but the `SearchResult` proto had no `icon_url` field. Cards displayed only generic `KindIcon` SVGs regardless of the resource. Meanwhile, `AgentSpec` and `McpServerSpec` already had `icon_url` fields in their proto definitions — the data existed at the resource level but was lost when flattened into search results. Additionally, none of the 52 MCP servers or 10 agents in the seedpack set `icon_url`, so even the detail views had no icons to show.

### Pain Points

- `SearchResult` had no `icon_url` field — the card grid could not display per-resource icons
- 0/52 MCP server seedpack entries and 0/10 agent seedpack entries had `icon_url` set
- The `ResourceIcon` component in the React SDK only accepted `kind`, not an icon URL
- Backend extractors discarded `spec.icon_url` when building `SearchResult` responses

## Solution

End-to-end plumbing: proto field addition, backend extractor changes, frontend component wiring, and seedpack data population. The approach preserves backward compatibility — `icon_url` defaults to empty string, and the UI falls back to the generic `KindIcon` when no URL is available or the image fails to load.

## Implementation Details

### Proto Change

Added `string icon_url = 13` to `SearchResult` in `apis/ai/stigmer/search/v1/io.proto`. Additive, non-breaking change — buf lint passes clean.

### Go Backend Extractors

Updated `ToSearchResult()` in two extractors:
- `mcpserver_extractor.go`: `IconUrl: mcp.GetSpec().GetIconUrl()`
- `agent_extractor.go`: `IconUrl: agent.GetSpec().GetIconUrl()`

No changes to `skill_extractor.go` or `workflow_extractor.go` — their specs have no `icon_url`.

### React SDK (ResourceListView.tsx)

- `ResourceIcon`: Added optional `iconUrl` prop. Renders `<img>` with `onError` fallback to `KindIcon`.
- `RowIcon`: New component for list layout — same pattern at row-icon sizing (4x4).
- `DefaultResourceCard` and `DefaultResourceRow`: Both pass `item.iconUrl` to the icon components.

### Seedpack — Stigmer Brand (11 files)

All Stigmer-org resources use `favicon.svg` via GitHub raw URL (repo confirmed public):
- `mcp-server-stigmer.yaml`
- All 10 system agents (`assistant`, `mcp-server-creator`, `agent-creator`, `skill-creator`, `slack-agent`, `code-review-agent`, `data-analyst-agent`, `docs-agent`, `research-agent`, `support-agent`)

### Seedpack — Vendor MCP Servers (18 files)

Added `icon_url` for 18 popular vendor MCP servers using verified, publicly accessible URLs:
- Official favicons: GitHub (`githubassets.com`), Figma (`static.figma.com`), Slack (`slack-edge.com`), Notion, Linear, Playwright, PostgreSQL, Supabase
- Wikimedia Commons: AWS (3 servers)
- SimpleIcons CDN: Stripe, Cloudflare, Sentry, MongoDB, Atlassian, Google Calendar, Google Maps

### Codegen

- `make protos` in stigmer (OSS): regenerated all stubs (Go, Java, Python, TypeScript) plus SDK clients
- `make protos` in stigmer-cloud: regenerated cloud stubs (Go, Java, Dart, TypeScript, Python)

## Benefits

- Per-resource icons now appear in the MCP Server and Agent library card grids
- SDK `ResourceIcon` and `RowIcon` components render custom icons with graceful fallback
- 29 seedpack resources ship with icons out of the box on fresh installations
- Platform builders using `@stigmer/react` automatically get icon rendering when `SearchResult.icon_url` is populated
- Fully backward compatible — empty `icon_url` falls back to generic `KindIcon`

## Impact

- **MCP Server library page**: 19/52 servers now show branded icons in card view
- **Agent library page**: All 10 system agents show the Stigmer logo icon
- **Detail views**: Resources that already read `spec.iconUrl` continue to work unchanged
- **Platform builders**: `SearchResult` type in all SDK languages (Go, TS, Python, Java, Dart) gains `icon_url`
- **Cloud follow-up**: Stubs regenerated; Java search service implementation is a separate PR

## Related Work

- [Library card grid layout](_changelog/2026-04/2026-04-13-171427-library-card-grid-layout.md) — the Phase 1 work that created the card grid and identified this as Phase 2
- `ProviderPicker` (`sdk/react/src/identity-provider/ProviderPicker.tsx`) — prior art for icon rendering with fallback
- Follow-up: Remaining ~34 vendor MCP servers need icon URLs curated
- Follow-up: Cloud Java search service needs `icon_url` population (analogous to Go extractor changes)

---

**Status**: ✅ Production Ready
**Files Changed**: 43 (stigmer), 9 (stigmer-cloud codegen)
