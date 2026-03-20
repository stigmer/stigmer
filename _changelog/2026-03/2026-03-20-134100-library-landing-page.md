# Library Landing Page

**Date**: March 20, 2026

## Summary

Added the Library landing page (`/library`) to the Stigmer Console, resolving the sidebar link (T01.9) to a real page. The page composes three SDK `ResourceCountCard` components with individual count hooks (`useAgentCount`, `useSkillCount`, `useMcpServerCount`) in a responsive grid. Also fixed a semantic gap in the count hooks' initial state that prevented loading skeletons from displaying.

## Problem Statement

The sidebar "Library" link shipped in Session 7 (T01.9) navigated to `/library`, which 404'd because no route existed. The landing page needed to be the first page a user sees when entering the Library — a summary view showing resource counts that link to detailed list pages.

### Pain Points

- Clicking "Library" in the sidebar resulted in a 404
- No overview of resource counts (agents, skills, MCP servers) existed in the Console
- Count hooks returned `count: 0` on initial render instead of `undefined`, defeating `ResourceCountCard`'s skeleton loading UX

## Solution

Created the `/library` route with a three-file structure following established Console patterns: a shared layout, a thin server component entry point, and a client component that composes SDK hooks and components. Fixed the count hook initial state to distinguish "not yet loaded" from "loaded, count is zero."

## Implementation Details

### Console pages (3 new files)

- `client-apps/web/src/app/library/layout.tsx` — Server component with `max-w-4xl` container shared by all `/library/*` routes. Wider than Settings' `max-w-3xl` to accommodate the 3-column card grid.
- `client-apps/web/src/app/library/page.tsx` — Thin server component delegating to `LibraryLanding`, following the `sessions/[id]/page.tsx` → `SessionPage.tsx` pattern.
- `client-apps/web/src/app/library/LibraryLanding.tsx` — Client component using `useActiveOrgSlug`, three independent count hooks, and `ResourceCountCard` from `@stigmer/react`. Data-driven card config via a `RESOURCE_CARDS` constant. SPA navigation via `href` + `onClick(preventDefault + router.push)`.

### SDK fix (4 files modified)

- `sdk/react/src/search/useResourceCount.ts` — Changed `useState(0)` → `useState<number | undefined>(undefined)` and updated the `if (!org)` reset. Return type now `count: number | undefined`.
- `useAgentCount.ts`, `useSkillCount.ts`, `useMcpServerCount.ts` — Updated `count` return type to `number | undefined`.

This is semantically correct: `undefined` means "not yet loaded" while `0` means "loaded, zero resources." `ResourceCountCard` already accepts `count?: number`, so the skeleton logic (`isLoading && count === undefined`) now works as designed.

## Benefits

- Library sidebar link resolves to a real page with live resource counts
- Loading skeletons display correctly on first render
- Cards link to `/library/agents`, `/library/skills`, `/library/mcp-servers` (routes built in T01.11–T01.13)
- Responsive layout: single column on mobile, 3 columns on `sm`+
- Clean foundation for "Create New" shortcuts (deferred to Phase 3)

## Impact

- **Console users**: Can now navigate to `/library` and see an overview of their resources
- **SDK consumers**: Count hooks now return `count: number | undefined` — a more correct API that distinguishes loading from zero. Minor type-level breaking change, but no external adopters yet.

## Related Work

- T01.9 (Session 7): Sidebar "Library" link
- T01.1–T01.4 (Sessions 1–3): Data hooks (`useAgentList`, `useSkillList`, `useMcpServerList`, count hooks)
- T01.5–T01.7 (Sessions 4–6): SDK components (`ScopeToggle`, `ResourceListView`, `ResourceCountCard`)
- T01.11–T01.13 (upcoming): Individual resource list pages

---

**Status**: ✅ Production Ready
