# Library: Skill List Page

**Date**: March 20, 2026

## Summary

Added the `/library/skills` route to the Stigmer Web Console, completing T01.12 of the Library & Artifacts Flow project. The page composes existing SDK hooks (`useSkillList`) and components (`ResourceListView`) into a Console page, following the pattern established by the Agent list page (T01.11).

## Problem Statement

The Library landing page displays a "Skills" card that links to `/library/skills`, which returned a 404 because the route didn't exist yet. Users could see skill counts on the landing page but had no way to browse the full list.

### Pain Points

- Skills card link on Library landing page pointed to a non-existent route
- No way to browse, search, or filter skills in the web console
- Inconsistent Library experience — agents browsable, skills not

## Solution

Created a thin Console page that wires the `useSkillList` SDK hook to the `ResourceListView` SDK component, with skill-specific labels, icons, and scope persistence. Zero SDK changes required — all building blocks were already in place from T01.1–T01.7.

## Implementation Details

Two new files, both in `client-apps/web` (Console-only routing concern):

- **`client-apps/web/src/app/library/skills/page.tsx`** — Server component entry point, imports and renders `SkillListPage`
- **`client-apps/web/src/app/library/skills/SkillListPage.tsx`** — Client component owning `scope`, `query`, and `page` state, calling `useSkillList`, and passing all data to `ResourceListView`

Domain-specific configuration:
- Search placeholder: "Search skills…"
- Empty state icon: `Sparkles` (lucide-react), matching the Library landing page card
- Scope persistence key: `stigmer:library:skills:scope` (localStorage)
- "Create Skill" ghost link navigating to `/` (pre-fill deferred to Phase 3)
- Breadcrumbs handled automatically by the shared `LibraryBreadcrumb` in the Library layout

Uses the default `ResourceListView` row renderer (name, org, description, visibility badge, tags). Skill-specific metadata (content hash) is not available on `SearchResult` — enriched rows deferred to Phase 5, consistent with the decision made for the Agent list page.

## Benefits

- Complete Library browsing experience for all three resource types (agents done in T01.11, skills done here, MCP servers next in T01.13)
- Zero new SDK surface area — purely a Console routing concern
- Scope preference persists per resource type across browser sessions
- Consistent UX pattern across all Library list pages

## Impact

- **Web Console users**: Can now browse, search, and filter skills with scope toggling (org vs. all)
- **Library landing page**: Skills card link now resolves correctly
- **Pattern establishment**: Confirms the list page pattern is clean and mechanical to replicate for additional resource types

## Related Work

- T01.11: Agent list page (pattern source) — `cf28c6d8`
- T01.10: Library landing page — `7eb73af3`
- T01.6: `ResourceListView` component — `6fa4e8ff`
- T01.2: `useSkillList` hook (SDK data layer)
- Next: T01.13 (MCP Server list page)

---

**Status**: ✅ Production Ready
**Timeline**: Single session, 2 files, 78 insertions
