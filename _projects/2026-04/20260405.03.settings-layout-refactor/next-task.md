# Next Task: 20260405.03.settings-layout-refactor

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260405.03.settings-layout-refactor

**Description**: Separate the web console into two distinct zones (agent/session zone vs management zone) and split the monolithic settings page into sub-pages with their own sidebar navigation, following the pattern used by Cursor's team management area.
**Goal**: Create a dedicated management zone with its own shell/layout that replaces the session sidebar with a management-specific sidebar when on /settings/** routes. Split Members, API Keys, and Environments into individual routed sub-pages (/settings/members, /settings/api-keys, /settings/environments) with a sidebar nav linking between them. Provide a clear 'Back to Sessions' zone-switch mechanism.
**Tech Stack**: Next.js App Router, React, TypeScript
**Components**: client-apps/web/src/components/layout/AppShell.tsx (zone detection/switching), client-apps/web/src/components/layout/ManagementSidebar.tsx (management zone sidebar), client-apps/web/src/app/settings/ (layout.tsx + sub-route pages), client-apps/web/src/components/settings/MembersSection.tsx, client-apps/web/src/components/settings/ApiKeysSection.tsx, client-apps/web/src/components/settings/EnvironmentsSection.tsx

## Current State
- **Status**: In Progress
- **Last Session**: 2026-04-06 (Session 8) — Placeholder nav items for future settings sections
- **Completed Task**: T01 — Phase 5 (Polish & Edge Cases) — all 5 items complete; placeholder nav items added

## Session Progress (2026-04-05)

### Session 1
- Created ManagementSidebar.tsx with OrgSwitcher, "Back to Sessions" link, nav links (Members/API Keys/Environments), and UserMenu
- Added zone detection in AppShell.tsx — swaps sidebars based on /settings/** pathname
- Restructured /settings route into sub-pages with shared layout
- Updated UserMenu to navigate to /settings/members
- Evaluated and deferred shared internal React lib proposal

### Session 2
- Verified deep-linking architecture via code analysis and browser testing
- Confirmed OIDC auth flow preserves deep-link URLs through sessionStorage
- Confirmed zone detection, ManagementSidebar, and SessionNavigationProvider all initialize correctly on cold load
- Added settings-scoped error boundary (app/settings/error.tsx) — preserves ManagementSidebar context on error
- Added settings-scoped loading boundary (app/settings/loading.tsx) — spinner for sub-page transitions
- Verified static export generates all settings HTML files correctly

### Session 3
- Created ManagementShell.tsx — schematic management zone shell for docs demos (org indicator, nav, user profile, slide transitions)
- Updated api-key-setup scenario to use ManagementShell for settings steps (zone transition from session sidebar to management sidebar)
- Inlined ApiKeysView content directly into the scenario as local helpers (ApiKeysPageChrome, PrefilledCreateForm)
- Deleted SettingsView.tsx and ApiKeysView.tsx — single-consumer views inlined, multi-consumer views (ComposerView, ResourceListPage, WidgetsSidebar) retained
- Decision: single-consumer demo views should be inlined; shared views earn separate files only when they have multiple consumers

### Session 4
- Added auto-close-on-navigate for mobile sidebar — `useEffect` keyed on `pathname` in AppShell closes sidebar when viewport < `lg` (1024px)
- Extracted `LG_BREAKPOINT = 1024` constant in `use-layout-state.tsx`, replacing magic number in Escape handler and new effect
- Made settings layout padding responsive (`px-4 sm:px-6 py-6 sm:py-8`)
- `make lint` clean (0 errors, 0 warnings)
- Key finding: backdrop/overlay/collapse was already working for ManagementSidebar via AppShell; only auto-close-on-navigate was missing

### Session 5
- Verified OrgSwitcher works correctly in management zone — dropdown opens, shows orgs, renders identically to session zone
- Discovered and fixed bug: `PersonalEnvironmentCard.bootstrapAttempted` ref not resetting on org switch, silently preventing auto-create for new orgs
- Code-verified all downstream SDK hooks (`useResourceAccess`, `useEnvironmentList`, `usePrincipalsCount`) properly refetch on org change
- Confirmed `ApiKeyListPanel` is intentionally identity-scoped (no org dependency)
- Browser-verified: all three settings sub-pages render, zone transition works, mobile auto-close works, deep-linking works
- `make lint` clean (0 errors, 0 warnings)

### Session 6
- Implemented SessionNavigationProvider state preservation — "Back to Sessions" now returns to the session the user was viewing before going to settings
- Added `lastSessionZonePath` to context and `currentSessionZonePath` state to track the true session-zone pathname across both pushState and Next.js navigation
- Updated ManagementSidebar to use `lastSessionZonePath` for dynamic "Back to Sessions" href
- Decision: Layer 1 only (remember last path) — Layer 2 (keep SessionZoneContent mounted) deferred for simplicity
- Used `useState` instead of `useRef` for `currentSessionZonePath` to satisfy `react-hooks/refs` lint rule (same pattern as Session 5 bootstrap fix)
- ESLint clean (0 errors, 0 warnings) on changed files

### Session 7
- Fixed `handlePopState` to explicitly capture `lastSessionZonePath` on zone exit — removed implicit ordering dependency between popstate handler and render-time sync block
- Added `currentSessionZonePathRef` mirroring state (follows existing `sessionIdRef` / `isSessionZoneRef` pattern) for synchronous access in event handler
- Browser-verified: zone transitions (session → management → back to session), management sub-page navigation, "Back to Sessions" returns to correct URL, deep-linking
- Phase 5 (Polish & Edge Cases) — all 5 items complete
- ESLint clean (0 errors, 0 warnings) on changed and related files

### Session 8 (2026-04-06)
- Added three placeholder nav items to ManagementSidebar: Billing (`CreditCard`), Usage (`BarChart3`), Org Profile (`Building2`)
- Items look and behave like normal sidebar links — same styling, hover, active state
- Each links to its own URL (`/settings/billing`, `/settings/usage`, `/settings/org-profile`) for correct active-state highlighting and URL stability
- Created shared `ComingSoon` component (`components/settings/ComingSoon.tsx`) — accepts `title` and optional `icon` prop, renders centered "coming soon" message
- Created three thin route pages that render `<ComingSoon />` within the existing settings layout
- Design decision: normal-looking links navigating to a "Coming soon" page (not disabled/muted items) — cleaner UX, establishes URLs for when features ship
- ESLint clean (0 errors, 0 warnings)

## Next Steps
1. ~~Phase 5: Polish & edge cases~~ **Complete** (all 5 items done, Session 4-7)
2. ~~Placeholder nav items for future sections~~ **Complete** (Session 8)
3. Visual testing across theme presets (Corporate, Fintech, Startup, Friendly)

## Context for Resume
- `ComingSoon` component is parameterized by `title` (string) and optional `icon` (Lucide component) — when a feature ships, replace the route page content and delete the `<ComingSoon />` usage
- Placeholder nav items are in the same `NAV_ITEMS` array as real items — no separate data structure, no `disabled` flag, no special rendering logic
- ManagementSidebar reuses OrgSwitcher and UserMenu directly — they are self-contained components
- Sidebar open/close state is shared across zones via useSidebarOpen() (localStorage)
- Existing section components (MembersSection, ApiKeysSection, EnvironmentsSection) are unchanged except the bootstrap fix
- The shared internal React lib idea was deferred — the demo views in site/ serve a different purpose (schematic illustration) and don't need real Console components
- Mobile sidebar auto-close fires on `pathname` change only — session Sidebar's `pushState`-based navigation is a separate concern
- `LG_BREAKPOINT` constant lives in `use-layout-state.tsx` alongside `useSidebarOpen()`
- OrgSwitcher is zone-agnostic: uses only `useOrg()` (global context), local state, and `sidebar-*` theme tokens
- All settings SDK hooks use a render-time state sync pattern for prop-change detection with effect-based refetch
- `ApiKeyListPanel` is identity-scoped (no org prop) — by design, not a bug
- Browser back/forward testing is complicated by OIDC auth pages in the history stack; real users build clean history via client-side `<Link>` navigation
- `currentSessionZonePathRef` mirrors the `currentSessionZonePath` state for synchronous access in the `handlePopState` event handler (same pattern as `sessionIdRef` and `isSessionZoneRef`)
- `handlePopState` now explicitly captures `lastSessionZonePath` when transitioning out of the session zone, removing the ordering dependency on the render-time sync block
- `lastSessionZonePath` in SessionNavigationProvider tracks the session-zone path the user was on before leaving; ManagementSidebar uses it for "Back to Sessions" href
- `currentSessionZonePath` (state, not ref) tracks the true session-zone path across both pushState and Next.js navigation; required because `prevPathname` from `usePathname()` misses pushState updates
- Layer 2 (keeping SessionZoneContent mounted while in management zone) was analyzed and deferred — adds complexity for marginal benefit; Layer 1 design does not preclude later addition

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.03.settings-layout-refactor/checkpoints/2026-04-06-session-8.md
```

### 2. Current Task
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.03.settings-layout-refactor/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.03.settings-layout-refactor/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.03.settings-layout-refactor/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.03.settings-layout-refactor/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.03.settings-layout-refactor/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.03.settings-layout-refactor/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/2026-04-06-session-8.md`
2. [ ] Check current task status in `tasks/`
3. [ ] Review any new design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with visual testing across theme presets

## Quick Commands

After loading context:
- "Continue with visual testing" - Test across theme presets
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
