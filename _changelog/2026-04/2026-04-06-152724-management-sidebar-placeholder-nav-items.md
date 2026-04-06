# Management Sidebar Placeholder Nav Items

**Date**: April 6, 2026

## Summary

Added three placeholder nav items (Billing, Usage, Org Profile) to the ManagementSidebar, each linking to a "Coming soon" page. This establishes the management zone's future scope and reserves URL paths for upcoming features, with zero disruption to existing navigation.

## Problem Statement

The management sidebar had three nav items (Members, API Keys, Environments) but the zone is planned to grow with Billing, Usage, and Org Profile sections. Without placeholders, users have no visibility into the management zone's trajectory, and URLs would need to be established later — creating migration risk.

### Pain Points

- Management sidebar felt incomplete — only three items for a zone that will eventually house six+ sections
- No forward signal to users about upcoming capabilities
- URLs for future sections weren't reserved, risking breaking changes when they ship

## Solution

Added three new entries to `NAV_ITEMS` in ManagementSidebar that look and behave like normal sidebar links. Each navigates to its own route page that renders a shared `ComingSoon` component — a centered message with the section's icon and "This feature is coming soon."

## Implementation Details

- **ManagementSidebar.tsx**: Added `CreditCard`, `BarChart3`, `Building2` icons and three new `NAV_ITEMS` entries. No interface or rendering logic changes — the new items use the exact same `<Link>` + active-state pattern as existing items.
- **ComingSoon.tsx**: New shared presentational component accepting `title` (string) and optional `icon` (Lucide component). Renders icon, heading, and subtitle centered with `py-24`.
- **Three route pages**: `billing/page.tsx`, `usage/page.tsx`, `org-profile/page.tsx` — each is a 5-line wrapper rendering `<ComingSoon />` within the existing settings layout shell.

## Benefits

- Users can see the management zone's future scope from the sidebar
- URLs (`/settings/billing`, `/settings/usage`, `/settings/org-profile`) are established — when features ship, replace page content with no routing changes
- Active-state highlighting works correctly per-item (each has its own pathname)
- Zero changes to existing navigation behavior or rendering logic

## Impact

- **Console users**: See three new sidebar items that navigate to informative "coming soon" pages
- **Developers**: Adding a new real settings section follows the established pattern — create a component, create a page, the nav item is already there

## Related Work

- Settings layout zone separation (Session 1-7 of this project)
- ManagementSidebar creation and polish

---

**Status**: Production Ready
