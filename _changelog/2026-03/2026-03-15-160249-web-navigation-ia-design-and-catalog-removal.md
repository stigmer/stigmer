# Web Navigation IA Design Decision & Catalog Removal

**Date**: March 15, 2026

## Summary

Designed the navigation information architecture for Stigmer Web — sidebar taxonomy, global header, breadcrumbs, and route structure — then executed the first round of code cleanup by removing the redundant catalog route and restructuring the sidebar to match the new IA. This is the Phase 3 (T05) deliverable of the web architecture alignment project.

## Problem Statement

The Stigmer Web sidebar had 4 items while 6+ routes were hidden from navigation. The unified catalog duplicated the individual resource pages. Draft occupied a top-level sidebar section despite every comparable platform placing creation within the resource section. The "Stigmer Console" brand name was incorrect — the product is "Stigmer."

### Pain Points

- Users couldn't discover `/agents`, `/skills`, `/mcp-servers` without knowing URLs or navigating through Catalog
- No way to return to Dashboard from the sidebar
- Catalog was redundant with individual resource pages that each had their own search
- Draft as a sidebar section split the mental model between browsing and creating the same resource
- Sessions page rendered `<div />` — a dead end promoted in the sidebar

## Solution

Produced a design decision document (`design-decisions/002-navigation-ia.md`) defining the complete navigation IA, then executed the catalog removal and sidebar restructure as the first implementation step.

## Implementation Details

**Design document** covers:
- Sidebar taxonomy: Dashboard (top-level) + 3 labeled sections (Operations, Resources, Platform)
- Global header: logo + "Stigmer" + org switcher + theme toggle + user profile
- Breadcrumb structure for all page depths
- Route changes with rationale and rejected alternatives

**Code changes** (91 additions, 604 deletions across 9 files):

| Action | File | Reason |
|--------|------|--------|
| Deleted | `app/catalog/page.tsx` | Redundant with individual resource pages |
| Deleted | `hooks/useUnifiedCatalog.ts` | Only consumer was catalog page |
| Deleted | `components/catalog/KindTabs.tsx` | Only consumer was catalog page |
| Modified | `config/navigation.ts` | Introduced `NavSection` type, replaced flat array with sectioned structure |
| Modified | `components/layout/Sidebar.tsx` | Section headers, root path active state fix, "Stigmer Console" to "Stigmer" |
| Modified | `app/page.tsx` | "Browse Catalog" quick action replaced with "Browse Agents" |
| Modified | `services/search-service.ts` | Removed dead `searchCatalog` function |
| Modified | `components/catalog/index.ts` | Trimmed barrel exports |

**Kept** (still used by resource pages): `ResourceList.tsx`, `ResourceCard.tsx`, `CatalogEmptyState.tsx`

## Benefits

- Every route is now reachable from the sidebar — no hidden pages
- Cognitive load reduced from 4 nav items + hidden routes to 7 clearly-organized items in 3 sections
- 604 lines of dead code removed (catalog page, unified catalog hook, kind tabs)
- Brand name corrected from "Stigmer Console" to "Stigmer"
- Foundation set for Phase 6 global header implementation and Phase 8 Settings/Workflows additions

## Impact

- **End users**: All resource pages are now discoverable from the sidebar. Draft actions move to contextual buttons on resource pages (implementation in T11).
- **Developers**: Clear IA document drives all future navigation work. Dead catalog code removed, reducing maintenance surface.
- **Architecture**: `NavSection` type introduced for labeled sidebar sections, replacing the `NavGroup` expandable pattern.

## Related Work

- Preceded by: [Phase 1: Dead code + tooling](2026-03-15-150158-web-phase1-dead-code-tooling.md), [Phase 2: Visual identity](2026-03-15-153808-web-visual-identity-theme-system.md)
- Drives: T11 (Global Header & Sidebar Redesign), T12 (Sessions Page), T13 (Dashboard Improvements)
- Design decision: `_projects/2026-03/20260315.02.web-architecture-alignment/design-decisions/002-navigation-ia.md`

---

**Status**: Production Ready
**Timeline**: ~30 minutes (collaborative design + code cleanup)
