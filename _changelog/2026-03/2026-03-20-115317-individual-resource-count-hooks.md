# Individual Resource Count Hooks for Library Landing Page

**Date**: March 20, 2026

## Summary

Added three individual resource count hooks (`useAgentCount`, `useSkillCount`, `useMcpServerCount`) to `@stigmer/react`, backed by a shared internal `useResourceCount` hook. These complete the data layer for the Library feature, providing lightweight count-only API calls for summary cards, badges, and dashboard widgets.

## Problem Statement

The Library landing page needs to display resource counts (e.g., "12 Agents, 5 Skills, 3 MCP Servers") without fetching full resource lists. The existing `useAgentList`, `useSkillList`, and `useMcpServerList` hooks return paginated entries — overkill for a scalar count.

### Pain Points

- No count-only API calls — consumers would need to use list hooks with `pageSize: 1` and read `totalCount`, which is semantically misleading
- Platform builders embedding Stigmer dashboard widgets need a purpose-built hook for counts, not a workaround on top of list hooks
- The original plan proposed a single combined `useResourceCount` returning all three counts, coupling three resource domains and making the API non-composable

## Solution

Individual count hooks following the same architecture as the list hooks: a shared internal hook in `search/` with thin domain wrappers in each resource module.

## Implementation Details

**Internal hook** — `useResourceCount` (`sdk/react/src/search/useResourceCount.ts`):
- Same `useState`/`useEffect`/`cancelled.current`/`fetchKey` pattern as `useResourceList`
- Calls `list()` with `page: { num: 1, size: 1 }` for minimal payload
- Tracks only `totalCount` in state — no entries, no pagination state
- Accepts optional `query` and `scope` parameters

**Public wrappers** — one per resource module:
- `useAgentCount` in `agent/`, `useSkillCount` in `skill/`, `useMcpServerCount` in `mcp-server/`
- Each: `useStigmer()` → `useCallback` for `stigmer.{resource}.list` → delegates to `useResourceCount`
- Returns `{ count, isLoading, error, refetch }`

**Barrel exports** — 5 files updated (`search/index.ts`, `agent/index.ts`, `skill/index.ts`, `mcp-server/index.ts`, `sdk/react/src/index.ts`)

## Benefits

- **Semantic clarity** — `useAgentCount("acme")` clearly communicates intent vs `useAgentList("acme", { pageSize: 1 }).totalCount`
- **Composability** — platform builders import only what they need; one failing API doesn't block others
- **Minimal footprint** — no entries stored in state, fewer re-renders than list hooks
- **Extensible** — adding a 4th resource type is a new hook, not a breaking change to a combined return type
- **Consistent architecture** — follows the exact internal-shared-hook + thin-wrapper pattern from T01.1–T01.3

## Impact

- **Platform builders**: New `useAgentCount`, `useSkillCount`, `useMcpServerCount` hooks available from `@stigmer/react` for dashboard widgets and summary displays
- **Console**: Library landing page can now render resource count cards with independent loading states
- **Data layer complete**: All 8 data hooks for Phase 1 Library are now implemented — next work shifts to UI components

## Related Work

- T01.1: `useAgentList` and internal `useResourceList` foundation
- T01.2: `useSkillList` data hook
- T01.3: `useMcpServerList` data hook
- Next: T01.5 `ScopeToggle` component (first UI work in the Library module)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
