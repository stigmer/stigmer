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
- **Last Session**: 2026-04-05 (Session 3) — Demo views aligned with management zone layout
- **Active Task**: T01 — Phase 5 (Polish & Edge Cases) — 1 of 5 items complete

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

## Next Steps
1. Phase 5: Polish & edge cases (1 of 5 complete)
   - Mobile responsiveness for ManagementSidebar (backdrop, collapse behavior)
   - Verify OrgSwitcher works correctly in management zone
   - ~~Verify deep-linking: opening /settings/api-keys directly loads correct page with management sidebar~~ ✓ Verified (Session 2)
   - Ensure browser back/forward navigation works across zone transitions
   - Test SessionNavigationProvider state preservation when returning from management zone
2. Visual testing across theme presets (Corporate, Fintech, Startup, Friendly)
3. Consider adding placeholder nav items for future sections (Billing, Usage, Org Profile)

## Context for Resume
- ManagementSidebar reuses OrgSwitcher and UserMenu directly — they are self-contained components
- Sidebar open/close state is shared across zones via useSidebarOpen() (localStorage)
- Existing section components (MembersSection, ApiKeysSection, EnvironmentsSection) are unchanged
- The shared internal React lib idea was deferred — the demo views in site/ serve a different purpose (schematic illustration) and don't need real Console components

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.03.settings-layout-refactor/checkpoints/2026-04-05-session-3.md
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

1. [ ] Read the latest checkpoint from `checkpoints/2026-04-05-session-3.md`
2. [ ] Check current task status in `tasks/`
3. [ ] Review any new design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with Phase 5 (Polish & Edge Cases) — 4 items remaining

## Quick Commands

After loading context:
- "Continue with Phase 5" - Resume polish and edge case work
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
