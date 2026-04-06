# Settings Information Architecture Reorganization

**Date**: April 6, 2026

## Summary

Reorganized the settings management zone from a flat list of 7 items under a generic "Settings" header into three logically grouped sections (Organization, Configuration, Billing & Usage) with a landing hub page. Removes the redundant shared header, adds section labels to the sidebar, and gives `/settings` a proper destination instead of a silent redirect.

## Problem Statement

The settings area presented Members, API Keys, Environments, Identity Providers, Billing, Usage, and Org Profile as a flat, ungrouped list. A shared "Settings" header with the subtitle "Manage your members, API keys, environments, identity providers, and configuration" sat above every sub-page — a vestige of the original single-page settings design that added cognitive noise without aiding navigation.

### Pain Points

- Flat sidebar list offered no conceptual grouping — users had to scan all items to find what they needed
- Shared "Settings" header was redundant (each section component already renders its own title)
- `/settings` silently redirected to `/settings/members` — no orientation point for users arriving from the UserMenu or a bookmark
- The subtitle tried to describe 7 unrelated concerns in one sentence

## Solution

Applied information architecture principles (Miller's Law for chunking, Gestalt proximity for visual grouping) to reorganize the sidebar into three labeled sections aligned with Stigmer's domain model. Replaced the redirect with a landing page that serves as a table of contents.

## Implementation Details

### Shared navigation config (`settings-nav.ts`)
- New file at `components/layout/settings-nav.ts` — single source of truth for group definitions
- Exports `SETTINGS_NAV_GROUPS` with `SettingsNavGroup` and `SettingsNavItem` types
- Each group has a label, description, and ordered items (with href, label, icon)
- Both ManagementSidebar and the landing page import from this config

### Grouped sidebar (ManagementSidebar)
- Replaced flat `NAV_ITEMS` with grouped rendering from `SETTINGS_NAV_GROUPS`
- Each group gets a muted uppercase section label (`text-[11px] font-medium uppercase tracking-wider`)
- Groups separated by `gap-4` whitespace (no visual separators — proximity principle)
- Item order within groups: Organization (Org Profile, Members, Identity Providers), Configuration (API Keys, Environments), Billing & Usage (Billing, Usage)

### Settings layout
- Removed `<h1>Settings</h1>` and `<p>Manage your...</p>` from the shared layout
- Added `<h1 className="sr-only">Settings</h1>` for screen reader heading hierarchy
- Container div with centering/padding preserved

### Landing hub page
- `/settings` now renders a page with three bordered cards (one per group)
- Each card shows group name, one-line description, and linked items with icons
- Replaces the silent `redirect("/settings/members")`

### UserMenu update
- `SettingsItem` now navigates to `/settings` (hub) instead of `/settings/members`
- Label and icon unchanged — "Settings" is the universally expected user menu entry point

## Benefits

- **Reduced cognitive load**: 7 flat items chunked into 3 groups of 2-3 items (Miller's Law)
- **Visual orientation**: Section labels provide instant context about what kind of page you're looking at
- **Honest navigation**: `/settings` has a real destination showing all options, not a hidden redirect
- **Single source of truth**: `settings-nav.ts` keeps sidebar and landing page groupings in sync
- **Accessibility**: `sr-only` h1 preserves heading hierarchy; `aria-current` and `aria-label` patterns unchanged

## Impact

- Console users see a more organized settings sidebar on every settings page
- Users arriving at `/settings` from the UserMenu or bookmarks see an overview hub instead of being dropped into Members
- No SDK impact — all changes are Console-specific (app shell, routing, page layout)

## Related Work

- Session 8: Added placeholder nav items (Billing, Usage, Org Profile) with ComingSoon component
- Sessions 1-7: Built the management zone with ManagementSidebar, zone detection, deep-linking, mobile support

---

**Status**: Production Ready
