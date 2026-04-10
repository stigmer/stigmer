# Add Source Provenance Section to MCP Server Detail View

**Date**: April 10, 2026

## Summary

Added a "Source" section to the MCP server detail view in the React SDK that displays provenance metadata for servers imported via the MCP Registry sync workflow. This gives platform builders and end-users visibility into where an MCP server definition originated — its registry, repository URL, version, GitHub star count, and last sync timestamp.

## Problem Statement

The MCP Registry sync workflow populates a `McpServerSource` message on every imported server definition, tracking its upstream registry, canonical name, version, repository URL, GitHub stars, and last sync time. This data was stored in the backend and available through the API, but the detail view in the web app never surfaced it.

### Pain Points

- Users had no way to inspect the upstream source of a marketplace MCP server entry
- The GitHub repository link — critical for trust and transparency — was invisible in the UI
- Version and freshness information (last synced) were hidden from users who needed to assess reliability
- GitHub star count, already fetched during sync, was going unused in the frontend

## Solution

Added a conditionally-rendered `SourceSection` internal component to `McpServerDetailView` in the React SDK. The section only appears for registry-synced servers (where `spec.source` is populated) and is completely absent for hand-authored definitions.

## Implementation Details

Single file change: `sdk/react/src/mcp-server/McpServerDetailView.tsx`.

- Imported `McpServerSource` type from the generated protobuf spec
- Derived `source` and `hasSource` from `spec?.source`, gated on having either a `registry` or `repositoryUrl`
- Placed `<SourceSection>` between the Header and Server Configuration sections
- Built `SourceSection` as an internal function component reusing the existing `Section` layout primitive
- Each field row (Registry, Name, Version, Repository, Stars, Last Synced) is individually conditionally rendered when it has a meaningful value
- Repository URL renders as a clickable `<a>` tag with `target="_blank"` and an inline `ExternalLinkIcon` SVG
- GitHub stars formatted with `toLocaleString()`, only shown when > 0
- Last synced date uses the existing `timestampDate` + `formatDate` pipeline
- Added `ExternalLinkIcon` inline SVG following the same zero-dependency icon pattern used throughout the file

No new hooks, files, exports, or dependencies. No changes to the web app, data fetching, or barrel exports.

## Benefits

- Users can now see exactly where an MCP server definition came from
- Repository URL provides a direct link to inspect the upstream source code for trust assessment
- Version and last-synced timestamp help users assess definition freshness
- GitHub star count offers a quick quality/popularity signal
- Conditionally rendered — zero visual impact on hand-authored servers

## Impact

- **SDK consumers**: `McpServerDetailView` automatically displays source provenance; no prop changes or configuration needed
- **Platform builders**: The section is themed via `--stgm-*` tokens and works identically in embedded contexts
- **End users**: Improved transparency for marketplace MCP server entries

## Related Work

- `feat(apis/mcpserver): add github_stars field to McpServerSource proto` — the proto field that enabled star display
- MCP Registry sync overhaul (2026-04-09) — the workflow that populates `spec.source`

---

**Status**: ✅ Production Ready
