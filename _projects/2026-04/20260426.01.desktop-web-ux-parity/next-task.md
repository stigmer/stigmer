# Next Task: 20260426.01.desktop-web-ux-parity

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260426.01.desktop-web-ux-parity

**Description**: Align the Stigmer desktop app UX to match the web console by extracting shared components (OrgProvider, OrgSwitcher, UserMenu, settings nav) into @stigmer/react, rebuilding the desktop app shell with org context switching, management sidebar, user menu, full settings surface, and library breadcrumbs, then migrating the web app to consume the same SDK components.
**Goal**: Users should have an identical experience when using the web app and the desktop app. Eliminate UX gaps (missing org switcher, incomplete settings, no user menu, no sidebar collapse, no library breadcrumbs) and eliminate duplicated code between the two client apps.
**Tech Stack**: TypeScript, React 19, @stigmer/react SDK, @stigmer/theme, @base-ui/react, Tauri v2 (desktop), Next.js 16 (web), react-router-dom v7 (desktop), Vite 6 (desktop)
**Components**: sdk/react (shared SDK extractions), client-apps/desktop (app shell rebuild), client-apps/web (migration to shared SDK components)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260426.01.desktop-web-ux-parity/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260426.01.desktop-web-ux-parity/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260426.01.desktop-web-ux-parity/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260426.01.desktop-web-ux-parity/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260426.01.desktop-web-ux-parity/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260426.01.desktop-web-ux-parity/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260426.01.desktop-web-ux-parity/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260426.01.desktop-web-ux-parity/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260426.01.desktop-web-ux-parity/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260426.01.desktop-web-ux-parity/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260426.01.desktop-web-ux-parity/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260426.01.desktop-web-ux-parity/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260426.01.desktop-web-ux-parity/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-04-26 12:05
**Current Task**: T01-E (Extract UserMenu to SDK)
**Status**: In Progress

## Session Progress (2026-04-26, Session 5 — T01-D)

- Completed T01-D: Moved `SETTINGS_NAV_GROUPS`, `SettingsNavItem`, `SettingsNavGroup` to `sdk/react/src/settings/settings-nav.ts`
- Created `sdk/react/src/settings/index.ts` barrel file following existing SDK directory pattern
- Added settings section to `sdk/react/src/index.ts` barrel exports
- Migrated both web consumers (`settings/page.tsx`, `ManagementSidebar.tsx`) to import from `@stigmer/react`
- Deleted `client-apps/web/src/domain/_shared/layout/settings-nav.ts`
- Fixed pre-existing dependency hygiene gap: added `lucide-react: ">=0.400.0"` as a non-optional peer dependency in `sdk/react/package.json` — the SDK was already importing Lucide icons in `OrgSwitcher.tsx` and `internal/menu.tsx` without declaring the dependency
- All verification targets pass: SDK lint + typecheck, web lint, desktop lint + typecheck + cargo check
- 4 pre-existing warnings in `SettingsRunners.tsx` (opacity modifier tokens, untouched files)
- Commit: `a7fbb8e70 refactor(sdk,web): extract SETTINGS_NAV_GROUPS to @stigmer/react`

## Session Progress (2026-04-26, Session 4 — T01-C)

- Completed T01-C: Extracted `OrgSwitcher` component to `sdk/react/src/organization/OrgSwitcher.tsx`
- Created SDK-internal Menu primitives at `sdk/react/src/internal/menu.tsx` (Menu, MenuTrigger, MenuContent, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator) — shared styled wrappers over `@base-ui/react/menu` for visual consistency across SDK components
- Designed `OrgSwitcherProps` with `onOrgChanged?` callback (fires only on user-initiated org switches, not initial load/refresh) and `className?`
- Dialog for "Create organization" inlined directly using `@base-ui/react/dialog` primitives (single consumer, no shared wrapper needed yet)
- Fixed token context correctness: OrgLabel now uses `text-sidebar-muted-foreground` in the trigger (sidebar context) and `text-muted-foreground` in dropdown items (popover context) — the web's original code used sidebar tokens in both, which was incorrect per DD-005
- Migrated web `Sidebar.tsx` and `ManagementSidebar.tsx` to import `OrgSwitcher` from `@stigmer/react`
- Deleted `client-apps/web/src/domain/_shared/layout/OrgSwitcher.tsx`
- Added `@base-ui/react` to desktop `package.json` dependencies (preparation for T02)
- Updated barrel exports in `sdk/react/src/organization/index.ts` and `sdk/react/src/index.ts`
- All verification targets pass: SDK lint + typecheck, web lint, desktop lint + typecheck + cargo check
- 4 pre-existing warnings in `SettingsRunners.tsx` (opacity modifier tokens, untouched files)

## Session Progress (2026-04-26, Session 3 — Desktop launch fix)

- Fixed invisible window on `make desktop-dev` — two root causes:
  1. `single_instance` callback in `lib.rs` was a no-op; duplicate launches silently exited without showing the hidden window
  2. `showWindowOnFirstPaint` in `main.tsx` used `requestAnimationFrame` which WebKit skips for hidden windows, creating a deadlock
- Fix: single_instance now shows/unminimize/focuses main window; replaced rAF with `setTimeout(80)`
- Verified via macOS CGWindowList: `OnScreen: true` after fix
- Added `verify-stigmer-oss-changes` cursor rule (pre-commit verification gate)
- Updated `commit-stigmer-oss-changes` cursor rule to invoke verify before commit
- Commit: `b7d6030f6 fix(desktop): resolve invisible window on launch`

## Session Progress (2026-04-26, Session 2 — T01-B)

- Completed T01-B: Extracted `useOrgGate()` behavior hook to `sdk/react/src/organization/useOrgGate.ts`
- Created `UseOrgGateOptions`, `OrgGateState` (discriminated union on `status`), and `UseOrgGateReturn` types
- `OrgGateState` uses variant-specific error data (error is a terminal status, not orthogonal) — deliberate deviation from `AgentSetupState` pattern, documented in plan
- Refactored desktop `OrgGate.tsx` — removed ~40 lines of state machine logic, now a thin renderer with `switch (state.status)`
- Refactored web `OrgGate.tsx` — same pattern, removed `useState`, `useEffect`, polling constants
- Updated barrel exports in `sdk/react/src/organization/index.ts` and `sdk/react/src/index.ts`
- All verification targets pass: SDK lint + typecheck, web lint, desktop lint + typecheck + cargo check
- 4 pre-existing warnings in `SettingsRunners.tsx` (opacity modifier tokens, untouched files)

## Session Progress (2026-04-26, Session 1 — T01-A)

- Completed T01-A: Extracted `OrgProvider`, `useOrg`, `useActiveOrgSlug` from both client apps into `sdk/react/src/organization/OrgProvider.tsx`
- Updated barrel exports in `sdk/react/src/organization/index.ts` and `sdk/react/src/index.ts`
- Migrated 13 desktop consumer files and 21 web consumer files to import from `@stigmer/react`
- Deleted `client-apps/desktop/src/org/OrgProvider.tsx` and `client-apps/web/src/domain/_shared/org/org-context.tsx`
- Dropped unused `useActiveOrg()` alias (zero external consumers)
- All verification targets pass: SDK lint + typecheck, web lint, desktop lint + typecheck + cargo check
- Exported `OrgContextValue` type for platform builders

## Next Steps

1. **T01-E**: Extract `UserMenu` to SDK — the final T01 subtask
2. **T02**: Desktop App Shell Rebuild — wire up all extracted SDK components into the desktop app

## Context for Resume

- T01 plan is in `tasks/T01_0_plan.md` — the full task breakdown with all subtask details
- T01-D plan is in `.cursor/plans/t01-d_settings_nav_extraction_c0c2a132.plan.md` — includes the lucide-react peer dependency decision
- T01-C plan is in `.cursor/plans/t01-c_orgswitcher_extraction_7376f8e8.plan.md` — architecture decisions for Menu primitives, Dialog inlining, props API, and token context
- SDK-internal Menu primitives live in `sdk/react/src/internal/menu.tsx` — T01-E (UserMenu) should import from here, not create its own menu wrappers
- Settings nav data now lives in `sdk/react/src/settings/settings-nav.ts` — T02 desktop management sidebar imports from `@stigmer/react`
- `lucide-react` is now a declared peer dependency of `@stigmer/react` (>=0.400.0, non-optional) — fixed in T01-D
- The `onOrgChanged` callback on `OrgSwitcher` fires only on user-initiated org changes — it does NOT fire on initial load or background refresh; this is the right primitive for "navigate on org switch"
- Desktop now has `@base-ui/react` as a dependency — ready for T02 when the desktop app renders the SDK OrgSwitcher
- Token context correctness pattern: trigger elements use sidebar-* tokens, portaled dropdown/dialog content uses popover-*/main-area tokens, with eslint-disable blocks + justification for portaled sections
- Key pattern established: SDK org hooks import from `../hooks` (relative), both client apps import from `@stigmer/react` (package)
- The `useOrgGate()` hook follows DD-003 (headless-first) and DD-004 (zero framework deps in SDK) — consumer computes routing/auth inputs, hook manages pure state machine
- T01-E details from T01 plan: UserMenu uses `useColorMode()` from SDK, callback-based props (`onSettingsClick`, `onSignOut`), `extraItems` slot for app-specific items (e.g. "Get Desktop App" in web), replaces `next-themes` with SDK's own color mode context

## Quick Commands

After loading context:
- "Continue with T01-E" - Pick up the final T01 subtask
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
