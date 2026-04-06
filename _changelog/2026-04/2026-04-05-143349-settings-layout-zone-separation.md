# Settings Layout Refactor — Zone Separation & Sub-Page Navigation

**Date**: April 5, 2026

## Summary

Separated the web console into two distinct zones (agent/session zone vs management zone) by adding a dedicated ManagementSidebar and restructuring the `/settings` route into individually navigable sub-pages. When visiting `/settings/**`, the session sidebar is replaced by a management-specific sidebar with direct links to Members, API Keys, and Environments.

## Problem Statement

The `/settings` page rendered all admin sections (Members, API Keys, Environments) as stacked content on a single scrolling page, with the session-history sidebar still visible alongside it.

### Pain Points

- The session sidebar is irrelevant when managing org settings — users are in a different mental zone (administration vs agent execution)
- A monolithic settings page doesn't scale as more admin sections are added (Billing, Usage, Org Profile, etc.)
- No deep-linkable URLs for individual settings sections
- Cursor's team management area and similar products use a separate sidebar for management navigation, which has become the expected pattern

## Solution

Introduced a zone detection layer in `AppShell` that detects `/settings/**` routes and swaps the session sidebar for a dedicated `ManagementSidebar`, and split the monolithic settings page into routed sub-pages.

## Implementation Details

### ManagementSidebar Component

New `ManagementSidebar.tsx` in `client-apps/web/src/components/layout/`. Structure mirrors the existing `Sidebar` for visual consistency:

- **Top row**: Collapse toggle + OrgSwitcher (reused from existing component)
- **"Back to Sessions"** link: Returns to `/`, re-enters the agent zone
- **Nav links**: Members, API Keys, Environments with active-state highlighting via `usePathname()`
- **Bottom**: UserMenu (reused from existing component)

Uses `sidebar-*` design tokens throughout for theme compliance.

### Zone Detection in AppShell

Added `usePathname()` to `AppShell.tsx` with a single `isManagementZone` derived flag. When true:

- Renders `ManagementSidebar` instead of `Sidebar`
- Renders `children` directly (bypasses `SessionZoneContent`)

The sidebar container (width, animations, mobile backdrop) is shared — only the inner content swaps.

### Settings Route Restructure

Converted the monolithic `/settings` page into a Next.js App Router layout with sub-routes:

- `app/settings/layout.tsx` — shared page chrome (title, max-width container)
- `app/settings/page.tsx` — redirects to `/settings/members`
- `app/settings/members/page.tsx` — renders `MembersSection`
- `app/settings/api-keys/page.tsx` — renders `ApiKeysSection`
- `app/settings/environments/page.tsx` — renders `EnvironmentsSection`

Existing section components (`MembersSection`, `ApiKeysSection`, `EnvironmentsSection`) are unchanged — they are simply rendered on their own pages now.

### Navigation Wiring

Updated the UserMenu `SettingsItem` to navigate to `/settings/members` instead of `/settings`.

## Benefits

- **Clear mental model**: Users know they're in "management mode" when the sidebar changes — no more ambiguity about context
- **Deep-linkable URLs**: `/settings/api-keys` can be bookmarked, shared, or linked from documentation
- **Scalability**: Adding a new settings section (Billing, Usage, etc.) requires only a new sub-route page and a nav item in ManagementSidebar
- **Preserved sidebar state**: `useSidebarOpen()` is shared across zones — collapse state persists when switching between agent and management zones

## Impact

- **Console users**: See a distinct management experience when navigating to Settings
- **Existing navigation**: Session sidebar, Library, and all agent-zone navigation remain completely unchanged
- **Future sections**: The pattern is established for adding Billing, Usage, Org Profile, etc.

## Files Changed

| File | Change |
|------|--------|
| `components/layout/ManagementSidebar.tsx` | New — management zone sidebar |
| `components/layout/AppShell.tsx` | Modified — zone detection, conditional sidebar rendering |
| `components/layout/UserMenu.tsx` | Modified — Settings link targets `/settings/members` |
| `app/settings/layout.tsx` | New — settings layout wrapper |
| `app/settings/page.tsx` | Modified — redirect to `/settings/members` |
| `app/settings/members/page.tsx` | New — wraps MembersSection |
| `app/settings/api-keys/page.tsx` | New — wraps ApiKeysSection |
| `app/settings/environments/page.tsx` | New — wraps EnvironmentsSection |

## Related Work

- IAM role-permission-separation project — added MembersSection and OrgMembersPanel
- Original settings page was added as part of API keys and environments features

---

**Status**: ✅ Production Ready
**Timeline**: Single session implementation
