# Task T01: Settings Layout Refactor — Zone Separation + Sub-Page Navigation

**Created**: 2026-04-05 14:08
**Status**: PENDING REVIEW
**Type**: Refactoring

⚠️ **This plan requires your review before execution**

## Problem Statement

The `/settings` page currently renders Members, API Keys, Personal Environment, and Environments as stacked sections on a single scrolling page, with the session sidebar still visible alongside it. This creates two UX problems:

1. **Wrong sidebar context**: When managing org settings, the session history sidebar is irrelevant. These are two different "zones" of the app (agent execution vs org administration).
2. **Monolithic settings page**: All admin concerns are crammed into one page. It doesn't scale as we add more sections (Billing, Usage, Org Profile, etc.).

**Reference**: Cursor's team management area — completely replaces the agent sidebar with a management-specific sidebar, and each admin concern (Members, Usage, Billing, etc.) is its own page.

## Architecture Overview

### Current State

```
AppShell
├── Sidebar (always: OrgSwitcher, New Session, Library, Recents, UserMenu)
└── Main Content
    ├── SessionZone (/, /sessions/[id])
    ├── LibraryZone (/library/**)
    └── SettingsPage (/settings) ← single page, all sections stacked
```

### Target State

```
AppShell
├── detects current zone from pathname
├── Zone: Agent (default)
│   ├── Sidebar (OrgSwitcher, New Session, Library, Recents, UserMenu)
│   └── Main: SessionZone or LibraryZone
└── Zone: Management (/settings/**)
    ├── ManagementSidebar (OrgSwitcher, Back to Sessions, nav links, UserMenu)
    └── Main: settings sub-page
        ├── /settings → redirects to /settings/members
        ├── /settings/members → MembersSection
        ├── /settings/api-keys → ApiKeysSection
        └── /settings/environments → EnvironmentsSection
```

## Task Breakdown

### Phase 1: Management Sidebar Component

Create `ManagementSidebar.tsx` — a sidebar specifically for the management zone.

- [ ] Create `client-apps/web/src/components/layout/ManagementSidebar.tsx`
- [ ] Include: OrgSwitcher at top (reuse existing)
- [ ] Include: "Back to Sessions" link (navigates to `/`, re-enters agent zone)
- [ ] Include: Nav links — Members, API Keys, Environments (with active state based on pathname)
- [ ] Include: UserMenu at bottom (reuse existing)
- [ ] Match sidebar styling tokens (`bg-sidebar`, `text-sidebar-foreground`, etc.)

### Phase 2: Zone Detection in AppShell

Modify `AppShell.tsx` to detect and switch between zones.

- [ ] Add zone detection: `pathname.startsWith("/settings")` → management zone
- [ ] When in management zone, render `ManagementSidebar` instead of `Sidebar`
- [ ] Ensure sidebar open/close state works for both sidebars
- [ ] Keep the existing `isSessionZone` logic for agent zone unchanged

### Phase 3: Settings Route Structure

Convert the monolithic `/settings` page into a layout with sub-routes.

- [ ] Create `app/settings/layout.tsx` — wraps settings sub-pages (page header, max-width container)
- [ ] Create `app/settings/members/page.tsx` — renders `MembersSection`
- [ ] Create `app/settings/api-keys/page.tsx` — renders `ApiKeysSection`
- [ ] Create `app/settings/environments/page.tsx` — renders `EnvironmentsSection`
- [ ] Update `app/settings/page.tsx` — redirect to `/settings/members` (or render a general overview)
- [ ] Existing section components stay as-is, just moved into their own pages

### Phase 4: Navigation Updates

Wire up entry/exit points between zones.

- [ ] UserMenu `SettingsItem` → navigate to `/settings/members` (instead of `/settings`)
- [ ] ManagementSidebar "Back to Sessions" → navigate to `/`
- [ ] Ensure sidebar collapse/expand button works in both zones
- [ ] Verify Library link still works from agent zone

### Phase 5: Polish & Edge Cases

- [ ] Mobile responsiveness for ManagementSidebar (backdrop, collapse behavior)
- [ ] Verify OrgSwitcher works correctly in management zone
- [ ] Verify deep-linking: opening `/settings/api-keys` directly loads the right page with management sidebar
- [ ] Ensure browser back/forward navigation works across zone transitions
- [ ] Test that SessionNavigationProvider state is preserved when returning from management zone

## Key Design Decisions

### Why a separate ManagementSidebar instead of conditionally hiding/showing sections in the existing Sidebar?
The two sidebars serve fundamentally different purposes and have different nav items. A separate component is cleaner than conditionally rendering half the sidebar. It also makes it easy to evolve each independently.

### Why sub-routes instead of tabs within a single page?
- Deep-linkable URLs (`/settings/members`)
- Each section loads independently (no wasted rendering)
- Scales naturally as more admin sections are added
- Follows the Library layout precedent already in the codebase

### Where does "Settings" entry point live?
Currently in the UserMenu dropdown (gear icon → "Settings"). This stays the same, just navigates to `/settings/members` instead of `/settings`.

## Files Changed

| File | Change |
|---|---|
| `components/layout/ManagementSidebar.tsx` | **New** — management zone sidebar |
| `components/layout/AppShell.tsx` | **Modified** — zone detection, conditional sidebar rendering |
| `app/settings/layout.tsx` | **New** — settings layout wrapper |
| `app/settings/page.tsx` | **Modified** — redirect to `/settings/members` |
| `app/settings/members/page.tsx` | **New** — wraps MembersSection |
| `app/settings/api-keys/page.tsx` | **New** — wraps ApiKeysSection |
| `app/settings/environments/page.tsx` | **New** — wraps EnvironmentsSection |
| `components/layout/UserMenu.tsx` | **Modified** — update Settings link target |

Existing section components (`MembersSection.tsx`, `ApiKeysSection.tsx`, `EnvironmentsSection.tsx`) remain **unchanged**.

## Success Criteria for T01

- [ ] Management zone has its own sidebar (not the session sidebar)
- [ ] Three settings sub-pages reachable via sidebar nav links
- [ ] "Back to Sessions" returns to agent zone
- [ ] Existing session and library navigation unaffected
- [ ] Deep-linking to `/settings/api-keys` works on fresh page load

## Estimated Effort

This is a focused refactoring — no new features, no backend changes, no SDK changes.
The existing section components are already self-contained. Main work is:
- ~80 lines for ManagementSidebar
- ~20 lines of changes in AppShell
- ~30 lines for settings layout + sub-page wrappers
- ~5 lines to update UserMenu link

## Review Process

**What happens next**:
1. **You review this plan** — does the zone separation approach feel right?
2. **Provide feedback** — any concerns about the sidebar design, nav structure, etc.
3. **I'll revise if needed** — update based on your input
4. **You approve** — I proceed with implementation
5. **Execution tracked** in T01_3_execution.md

**Please consider**:
- Does the management sidebar content feel right? (OrgSwitcher, Back to Sessions, Members/API Keys/Environments, UserMenu)
- Should `/settings` redirect to `/settings/members` or show a general overview page?
- Any other sections you'd want in the management sidebar soon (e.g., Org Profile, Billing)?
- Should the Settings entry point stay in the UserMenu dropdown, or should it also be a sidebar link in the agent zone?
