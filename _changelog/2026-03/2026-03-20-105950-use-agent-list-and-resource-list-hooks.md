# `useAgentList` Data Hook and `useResourceList` Internal Foundation

**Date**: March 20, 2026

## Summary

Added the `useAgentList` data hook to `@stigmer/react` for the Library page, backed by a new internal `useResourceList` hook that provides paginated, scope-aware resource listing. This is the first building block of the Library feature (T01.1), establishing the shared foundation that `useSkillList` and `useMcpServerList` will reuse.

## Problem Statement

The Library page needs to display paginated lists of agents, skills, and MCP servers with search filtering and an org/all scope toggle. The existing `useAgentSearch` hook is designed for picker/type-ahead UX — it manages internal debounced query state, is hardcoded to page 1, and exposes no pagination metadata or scope control. A new hook is needed for the Library browse UX where the consumer controls pagination, query timing, and scope.

### Pain Points

- No hook exists for paginated resource browsing with scope filtering
- `useAgentSearch` serves a different UX pattern (picker vs. Library browse)
- Three resource types (agents, skills, MCP servers) need identical list behavior — duplicating logic across three hooks would be wasteful

## Solution

Created a two-layer hook architecture mirroring the existing `useResourceSearch` / `useAgentSearch` pattern:

1. **`useResourceList`** (internal, in `search/`) — Generic hook accepting a `listFn`, providing pagination, scope-to-`excludePublic` mapping, text query, and standard `{ entries, totalCount, totalPages, currentPage, isLoading, error, refetch }` return shape.

2. **`useAgentList`** (public, in `agent/`) — Thin wrapper injecting `stigmer.agent.list` and remapping `entries` → `agents`.

## Implementation Details

### New Files

- **`sdk/react/src/search/useResourceList.ts`** — Internal hook with:
  - `scope: "org" | "all"` mapped to `excludePublic` on `ListParams`
  - Offset-based pagination (`page`/`pageSize`) matching the SearchService API
  - No debouncing — consumer controls query timing (unlike `useResourceSearch`)
  - `org: null` skips fetch (established pattern from `useAgentInstanceList`)

- **`sdk/react/src/agent/useAgentList.ts`** — Public hook wrapping `useResourceList` with:
  - Stable `listFn` via `useCallback`
  - Domain-specific return field (`agents` instead of `entries`)
  - Full JSDoc with examples

### Modified Files

- `sdk/react/src/search/index.ts` — Exports `useResourceList`, `ResourceListScope`, types
- `sdk/react/src/agent/index.ts` — Exports `useAgentList`, types
- `sdk/react/src/index.ts` — Re-exports from agent module

### Key Discoveries During Implementation

1. `AgentClient.list()` delegates to `SearchService.search()` — returns `SearchResult[]` projections, not full `Agent` resources. Correct for list views.
2. Pagination is offset-based (`{ num, size }`), not cursor-based as originally planned.
3. Scope toggle maps cleanly to the existing `excludePublic` field: `"org"` = `true`, `"all"` = `false`.

## Benefits

- **Reusable foundation**: `useResourceList` will be reused by `useSkillList` and `useMcpServerList` as one-line wrappers
- **Clean separation**: Library browse hooks (`useAgentList`) and picker hooks (`useAgentSearch`) serve distinct UX patterns without overlap
- **Platform builder friendly**: External consumers control all parameters — no hidden internal state management
- **Pattern consistent**: Follows every established convention in the codebase (cancellation, fetchKey refetch, null-org skip, JSDoc)

## Impact

- **`@stigmer/react`**: New public export `useAgentList` + types; new internal `useResourceList` hook
- **Platform builders**: Can now build paginated agent list UIs with scope and search
- **Library feature**: Foundation for T01.2, T01.3, and eventually the Library pages (T01.10–T01.13)

## Related Work

- Part of project `20260320.01.library-and-artifacts-flow` (Phase 1: Library Pages + Navigation)
- Builds on existing `useResourceSearch` / `useAgentSearch` pattern
- Next: T01.2 (`useSkillList`), T01.3 (`useMcpServerList`), T01.4 (`useResourceCount`)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
