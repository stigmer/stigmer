# Sidebar Library Navigation Link

**Date**: March 20, 2026

## Summary

Added a "Library" navigation link to the Console sidebar, establishing the entry point for the Library feature. The link sits alongside "New Session" as a primary navigation item, with active state detection for all `/library/*` routes.

## Problem Statement

The Library feature (T01.1–T01.7) built data hooks and UI components in `@stigmer/react`, but the Console had no way for users to navigate to the Library pages. The sidebar only contained session-related navigation.

### Pain Points

- No entry point for the Library feature in the Console navigation
- Sidebar `aria-label` was "Sessions" but would need to describe broader navigation once Library was added

## Solution

Added a `Library` link to `Sidebar.tsx` between "New Session" and the separator, using the Gestalt proximity principle to group both primary navigation items together. Active state detection covers all `/library/*` sub-routes.

## Implementation Details

Single file change to `client-apps/web/src/components/layout/Sidebar.tsx` (20 insertions, 2 deletions):

- Imported `Library` icon from lucide-react
- Added `isLibraryActive = pathname.startsWith("/library")` for route-aware active state
- Library link with conditional `cn()` styling: active uses `bg-sidebar-accent text-sidebar-accent-foreground`, inactive matches "New Session" pattern
- `aria-current="page"` when active, consistent with session link accessibility pattern
- Updated `<nav>` `aria-label` from `"Sessions"` to `"Main navigation"`

## Benefits

- Users have a clear, discoverable entry point for the Library feature
- Active state provides wayfinding context when browsing Library sub-pages
- Consistent styling and accessibility with existing sidebar patterns
- Grouped layout creates clean information hierarchy (primary nav vs temporal recents)

## Impact

- **Console users**: New sidebar link visible on all pages, active state on Library routes
- **No SDK impact**: This is a Console-only change (`client-apps/web`)
- **No breaking changes**: All existing sidebar behavior preserved

## Related Work

- T01.1–T01.7: SDK data hooks and UI components (already shipped)
- T01.10: Library landing page (next — will make the `/library` route functional)
- T01.11–T01.13: Resource list pages

---

**Status**: Production Ready
**Timeline**: Session 7 of Library & Artifacts Flow project
