# ResourceListView — Core Library Browse Component

**Date**: March 20, 2026

## Summary

Implemented `ResourceListView`, the central paginated list component for the Library feature in `@stigmer/react`. This is the core UI building block that all three Library list pages (Agents, Skills, MCP Servers) will consume. It composes `ScopeToggle`, search input with internal debouncing, pagination, and standard loading/error/empty states into a single, progressively-enhanceable component.

## Problem Statement

The Library feature needs a consistent list experience across three resource types. Each list page requires the same chrome: a search toolbar, an org/all scope toggle, paginated rows, skeleton loading, error display with retry, and empty state messaging. Building this separately per page would create redundancy and inconsistency.

### Pain Points

- No reusable list component existed in the SDK for Library-style browsing
- Platform builders embedding Stigmer would need to assemble search + scope + pagination + states from scratch
- The three resource types (agents, skills, MCP servers) all share `SearchResult[]` as their data shape, making a shared component natural

## Solution

A single controlled presentation component that renders the full list chrome while delegating data fetching to the parent via hooks. Progressive enhancement through optional props ensures the component scales from a 2-prop minimal usage to full-featured with search, scope, pagination, and custom row rendering.

## Implementation Details

**File**: `sdk/react/src/library/ResourceListView.tsx` (~430 lines, single file)

### Component Architecture

Six internal sub-components (not exported), each handling one concern:
- **SearchToolbar** — search input with 300ms internal debounce + ScopeToggle
- **DefaultResourceRow** — built-in row renderer for `SearchResult` showing name, org, description, visibility badge, tags
- **SkeletonRows** — 5 animated placeholder rows with variable widths
- **EmptyState** — configurable icon + title + description
- **ErrorState** — destructive-colored message + optional retry button
- **PaginationBar** — Previous/Next with "Page X of Y" + result count

### Key Design Decisions

1. **SearchResult-typed, not generic** — all three resource types return the same `SearchResult[]` projection, enabling a useful default row renderer out of the box
2. **Progressive enhancement** — only `items` + `isLoading` required; search, scope, pagination, custom rendering activate via optional props
3. **Component-managed debounce** — raw input state lives in the component, parent only sees debounced values (300ms), eliminating boilerplate
4. **Automatic page reset** — changing search or scope calls `onPageChange(1)` to prevent stale pagination
5. **Stable callback refs** — debounce timer uses refs for callbacks to avoid resetting on parent re-renders

### Accessibility

- `role="search"` toolbar, `role="list"` + `role="listitem"` structure
- Roving tabindex with Arrow Up/Down keyboard navigation for interactive items
- `role="button"` with Enter/Space activation on clickable rows
- `role="alert"` for errors, `role="status"` for empty state, `aria-busy` during loading
- `<nav aria-label="Pagination">` with labeled Previous/Next buttons

### Icons

8 inline SVGs (16x16 viewBox) for resource kind differentiation: Agent (bot), Skill (lightning), MCP Server (server stack), Workflow (merge graph), Document (fallback), Search (magnifying glass), ChevronLeft, ChevronRight.

## Benefits

- **Platform builder DX**: Minimal usage is `<ResourceListView items={agents} isLoading={isLoading} />` — passes the 5-minute integration test
- **Console consistency**: All three Library pages will share identical chrome and behavior
- **Embeddable**: Zero Console dependencies, all styles via `--stgm-*` tokens, works identically in third-party dashboards
- **Accessible out of the box**: Full keyboard navigation and screen reader support without platform builder effort

## Impact

- **SDK surface**: 1 new component export (`ResourceListView`), 1 new type export (`ResourceListViewProps`)
- **Unblocks**: T01.7 (ResourceCountCard), T01.9–T01.13 (sidebar + Console pages)
- **Library feature**: Data layer (T01.1–T01.4) + UI components (T01.5–T01.6) now complete for Phase 1

## Related Work

- T01.1–T01.4: Data hooks (`useAgentList`, `useSkillList`, `useMcpServerList`, count hooks)
- T01.5: `ScopeToggle` component (consumed by `ResourceListView`)
- T01.7 (next): `ResourceCountCard` for Library landing page
- T01.9–T01.13 (upcoming): Console sidebar + page integration

---

**Status**: ✅ Production Ready
**Timeline**: Session 5 of the Library & Artifacts Flow project
