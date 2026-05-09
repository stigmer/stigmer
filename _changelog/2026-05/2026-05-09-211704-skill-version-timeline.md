# Skill Version Timeline

**Date**: May 9, 2026

## Summary

Added a full-stack version timeline for skills — proto-first RPC contract (`listVersions`), generated multi-language SDKs, a generic `VersionTimeline` component in `@stigmer/react`, and conditional tab integration in `SkillDetailView`. The frontend ships ahead of the backend with graceful degradation, enabling parallel development.

## Problem Statement

Skills are content-addressed artifact packages pushed as ZIPs. Unlike agents and MCP servers (which live in Git), skills have no built-in version browsing in the Console. Users pushing updates had no way to see push history, compare versions, or roll back — the current skill detail page only shows the latest version hash.

### Pain Points

- No visibility into skill version history from the Console
- No way to see who pushed what, when, or from which git commit
- No foundation for version comparison (prerequisite for T05-D diff viewer)
- No RPC surface for querying historical versions (data existed in `SkillAuditRepo` but wasn't exposed)

## Solution

Contract-first development: define the `listVersions` RPC in proto, generate types for all SDKs, build the frontend against generated types, and gracefully degrade until the backend implements the handler. A generic `VersionTimeline` component enables future reuse for any versioned resource.

## Implementation Details

### Proto Layer

- `ListSkillVersionsInput` — org + slug + cursor pagination
- `SkillVersionEntry` — version_hash, pushed_at, pushed_by (actor), tag, is_current, git_provenance, message, artifact_storage_key
- `ListSkillVersionsResponse` — versions array + next_page_token + total_count
- `listVersions` RPC added to `SkillQueryController` with skip-authorization (org+slug resolution in handler)

### Generated SDKs (via `make codegen` and `make protos`)

- TypeScript: `SkillClient.listVersions()` in `@stigmer/sdk`
- Go: `SkillQueryControllerClient.ListVersions()` in `sdk/go`, `mcp-server/proto`
- Python: `SkillQueryControllerStub.ListVersions()` in `sdk/python`
- Java: `SkillClient.listVersions()` in `sdk/java`

### React SDK (`@stigmer/react`)

**Generic version-history module** (`sdk/react/src/version-history/`):
- `VersionEntry` — presentation-layer type (not proto-coupled) for cross-resource reuse
- `VersionTimeline` — accessible vertical timeline with loading skeleton, empty state, compare-mode selection (for T05-D)
- `VersionTimelineEntry` — single row with hash badge, relative time, actor, tag, current indicator, git commit link

**Skill-specific hook** (`sdk/react/src/skill/useSkillVersions.ts`):
- Uses `useFetch` + generated `listVersions` RPC
- Maps `SkillVersionEntry` proto → generic `VersionEntry`
- Catches gRPC `UNIMPLEMENTED` (code 12) → treats as empty (graceful degradation)
- Returns `{ versions, isEmpty, isLoading, error, refetch }`

**Detail page integration** (`SkillDetailView.tsx`):
- Conditional "Versions" built-in tab (same pattern as Agent's "Dependencies")
- Tab only appears when `useSkillVersions` returns data
- `onVersionSelect` prop for consumer navigation

## Benefits

- **Full version visibility**: Users can browse skill push history with timestamps, actors, tags, and git provenance
- **Zero-downtime frontend**: Ships ahead of backend — graceful degradation means no broken UI
- **Multi-SDK generated**: All language SDKs (TS, Go, Python, Java) get the client method for free
- **Reusable foundation**: `VersionTimeline` component works for any versioned resource — ready for Agent/MCP versioning later
- **T05-D ready**: Compare-mode selection API built in from day one

## Impact

- **Platform builders**: Can embed version history in their own products via `useSkillVersions` + `VersionTimeline`
- **Console users**: Will see version history once backend ships (zero Console changes needed)
- **Backend team**: Clear contract defined in proto — implement `listVersions` handler and the UI activates automatically
- **Future work**: T05-D (diff viewer) has its data flow ready — select two versions, fire `onCompare`, fetch both artifacts

## Related Work

- T05-A: Detail Page Tabbed Infrastructure (prerequisite — provides mount point)
- T05-B: Agent Dependency Graph (same conditional tab pattern)
- T05-D: Diff Viewer (depends on this — uses `onCompare` callback and `artifact_storage_key`)
- T05-E: Backend API Requirements Doc (will reference this proto contract)

---

**Status**: ✅ Production Ready (frontend complete; backend RPC handler pending)
**Timeline**: 1 session
