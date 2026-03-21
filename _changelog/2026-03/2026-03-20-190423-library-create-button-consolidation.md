# Library Landing: Consolidate Create Buttons into Single Dropdown

**Date**: March 20, 2026

## Summary

Replaced the three separate "Create Agent / Skill / MCP Server" links on the Library landing page with a single "+ Create" button that opens a dropdown menu. This reduces visual clutter while keeping all creation options one click away, following the established popover pattern used elsewhere in the codebase.

## Problem Statement

The Library landing page displayed three individual "Create" links below the resource count cards — one for each resource type (Agent, Skill, MCP Server). While functional, this scattered three text links across a row for an action that can be cleanly unified.

### Pain Points

- Three separate create links added visual noise to an otherwise clean landing page
- The pattern does not scale well if additional resource types are introduced
- A single entry point with a menu is a well-established UX convention (GitHub, GitLab, Linear) that users already understand

## Solution

Consolidated the three links into a single "+ Create" button that opens a `@base-ui/react/popover` dropdown menu showing Agent, Skill, and MCP Server options — each with its icon and label. Each menu item is a Next.js `<Link>` navigating to the existing draft session URL, preserving right-click / open-in-new-tab behavior.

## Implementation Details

- **File changed**: `client-apps/web/src/app/library/LibraryLanding.tsx`
- Removed the `CREATE_SHORTCUTS` array and its rendering loop
- Added `CREATE_MENU_ITEMS` typed with `DraftResourceType` for type safety
- Added a `CreateResourceMenu` local component (private to the file) using the same `Popover` pattern established in `ConfigureMenu.tsx`
- Menu items use `role="menu"` / `role="menuitem"` for proper accessibility semantics
- No SDK, list page, or `draft-session.ts` changes — scoped strictly to the landing page

## Benefits

- Cleaner Library landing page with a single action entry point
- Follows Hick's Law (3 options don't need search) and Fitts's Law (one larger target vs three small ones)
- Consistent with the existing `@base-ui/react/popover` pattern used in `ConfigureMenu`
- List pages retain their individual "Create X" buttons, which remain contextually appropriate

## Impact

- **Console users**: Library landing page is visually cleaner; creation flow is unchanged
- **SDK**: No impact — this is a Console-only change
- **List pages**: Unchanged — each keeps its own scoped "Create X" link

## Related Work

- Draft session infrastructure (`draft-session.ts`, `SessionLauncher.tsx`) established in prior commits
- `ConfigureMenu.tsx` popover pattern in `@stigmer/react` used as the reference implementation

---

**Status**: ✅ Production Ready
