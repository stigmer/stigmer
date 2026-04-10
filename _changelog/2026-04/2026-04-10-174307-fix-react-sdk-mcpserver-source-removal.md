# Fix React SDK Build Break After McpServerSource Removal

**Date**: April 10, 2026

## Summary

Fixed a TypeScript build failure in the React SDK's `McpServerDetailView` component caused by the earlier proto refactor that deleted `McpServerSource` and flattened its fields directly onto `McpServerSpec`. The component still referenced the removed type and nested `source` field, breaking `make check`.

## Problem Statement

After commit `c592e810` (`refactor(apis/mcpserver): delete McpServerSource and flatten provenance onto McpServerSpec`), the generated TypeScript proto stubs no longer exported `McpServerSource` or included a `source` field on `McpServerSpec`. The React SDK component `McpServerDetailView.tsx` was not updated to match, producing two TypeScript errors:

### Pain Points

- `McpServerSource` imported from `spec_pb` no longer exists
- `spec.source` property access fails — `source` was removed from `McpServerSpec`
- `make check` fails at the `npm run build -w @stigmer/react` step, blocking CI

## Solution

Aligned the `McpServerDetailView` component with the flattened proto schema by:

1. Replacing the `McpServerSource` import with `McpServerSpec`
2. Reading `repositoryUrl` and `githubStars` directly from `spec` instead of `spec.source`
3. Rewriting the `SourceSection` component to accept `McpServerSpec` and render only the two fields that remain on the spec (`repositoryUrl`, `githubStars`)
4. Removing UI sections for fields that no longer exist in the proto (`registry`, `registryName`, `version`, `qualityTier`, `qualityScore`, `lastSyncedAt`)

## Implementation Details

**File changed**: `sdk/react/src/mcp-server/McpServerDetailView.tsx`

- **Import**: `McpServerSource` → `McpServerSpec`
- **Source detection**: `spec?.source && (source.registry || source.repositoryUrl)` → `spec && (spec.repositoryUrl || spec.githubStars > 0)`
- **SourceSection prop**: `source: McpServerSource` → `spec: McpServerSpec`
- **Net effect**: −55 lines removed (nested source fields UI), clean build

## Benefits

- `make check` passes end-to-end for the stigmer repo
- CI unblocked for the `feat/curated-mcp-marketplace` branch
- Component correctly reflects the current proto schema

## Impact

- **React SDK**: `McpServerDetailView` component renders correctly with the flattened spec
- **Marketplace UI**: Source section now shows Repository and Stars when available, without referencing removed registry metadata fields

## Related Work

- Follows `c592e810` — `refactor(apis/mcpserver): delete McpServerSource and flatten provenance onto McpServerSpec`
- Part of the curated MCP marketplace feature branch

---

**Status**: ✅ Production Ready
