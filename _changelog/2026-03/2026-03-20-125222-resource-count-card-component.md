# ResourceCountCard — Library Landing Page Card Component

**Date**: March 20, 2026

## Summary

Added `ResourceCountCard` to `@stigmer/react` — a self-contained, polymorphic-root card component that displays a resource type icon, count, and label. Designed for Library landing pages and resource dashboards, with accessible navigation semantics, loading skeletons, and full `--stgm-*` token theming.

## Problem Statement

The Library landing page (T01.10) needs navigation cards that show resource counts for Agents, Skills, and MCP Servers. These cards are not Console-specific — platform builders embedding a resource dashboard need the same component.

### Pain Points

- No card component existed in the `library/` module for summary/navigation tiles
- The data hooks (`useAgentCount`, `useSkillCount`, `useMcpServerCount`) were ready but had no companion styled component
- Platform builders would need to build their own card UI to display resource counts

## Solution

Built `ResourceCountCard` as a purely presentational SDK component in `@stigmer/react` with a polymorphic root element that adapts to navigation context.

## Implementation Details

- **File**: `sdk/react/src/library/ResourceCountCard.tsx` (new, ~160 lines)
- **Polymorphic root**: `<a>` when `href` is provided (link semantics), `<button>` when only `onClick` (action semantics), `<div>` when neither (static display)
- **Progressive loading**: Icon and label render immediately; count shows skeleton pulse only when `isLoading && count === undefined`. Existing count stays visible during refresh.
- **Accessibility**: `aria-label` on interactive variants (`"Agents: 42"` / `"Agents: loading"`), native keyboard behavior inherited from `<a>` and `<button>` elements
- **Visual**: `tabular-nums` for stable digit widths, `toLocaleString()` for locale-aware formatting, `no-underline` to prevent host app anchor style leakage
- **Theming**: All visual properties via `--stgm-*` tokens (`bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `bg-accent`, `ring-ring`, `bg-muted`)
- **Barrel exports**: Added to `library/index.ts` and `sdk/react/src/index.ts`

## Benefits

- Platform builders get a drop-in card component for resource dashboards — no glue code
- Hooks remain independently importable for custom UIs (headless-first preserved)
- The `library/` module now has a complete component set for the Library feature: `ScopeToggle`, `ResourceListView`, `ResourceCountCard`
- Polymorphic root gives native link accessibility without coupling to any routing library

## Impact

- **SDK surface**: 2 new exports (`ResourceCountCard`, `ResourceCountCardProps`)
- **Breaking changes**: None — all existing exports unchanged
- **Unblocks**: T01.10 (Library landing page), which composes three `ResourceCountCard` instances

## Related Work

- T01.4: Individual resource count hooks (data layer for this component)
- T01.5: `ScopeToggle` (first Library UI component)
- T01.6: `ResourceListView` (list component for resource browsing)
- T01.10: Library landing page (next consumer of this component)

---

**Status**: ✅ Production Ready
