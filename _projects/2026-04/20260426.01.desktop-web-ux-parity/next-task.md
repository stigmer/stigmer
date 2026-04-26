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
**Current Task**: PROJECT COMPLETE
**Status**: T01 Done, T02 Done, T03 Done — all tasks complete, both apps at full parity

## Session Progress (2026-04-26, Session 13 — Library Card Alignment Fix)

- Fixed Library landing page card alignment in the desktop app — cards were collapsing to intrinsic content width (~300px total) instead of filling the grid columns within the `max-w-4xl` container
- Root cause: `mx-auto` on a flex child in a `flex-direction: column` container overrides `align-items: stretch`, causing the child to shrink to content width — the grid's `1fr` columns then collapsed to minimum content size
- Fix: Added `div.h-full.overflow-y-auto` wrapper to `LibraryLayout.tsx`, matching the `SettingsLayout` pattern — creates a block formatting context where `mx-auto` works correctly
- Web app was unaffected (intermediate `overflow-y-auto` wrapper in `AppShell` already provided the block context)
- All verification targets pass: desktop lint + typecheck + cargo check (0 errors, 9 pre-existing warnings in untouched files)
- File changed: `client-apps/desktop/src/pages/library/LibraryLayout.tsx`

## Session Progress (2026-04-26, Session 12 — Monochrome Theme Alignment)

- Removed `VersionFooter` from desktop sidebar (static version text + update-available prompt) — cleaned up `useState`, `getVersion`, `ArrowUpCircle`, `useAppUpdaterContext` imports
- Set `preset="monochrome"` on web console's `StigmerProvider` in both `StigmerTransportBridge.tsx` (authenticated app) and `LoginPageView.tsx` (pre-auth login page) — web now matches desktop's monochrome visual identity
- Removed dead flash-prevention inline script from `layout.tsx` that read `stgm-theme-preset` from localStorage (no UI existed to write it)
- All verification targets pass: web lint (clean), desktop lint + typecheck + cargo check (0 errors, 9 pre-existing warnings)
- Commit: `9c51a770d refactor(web,desktop): align web console to monochrome theme and remove version footer`

## Session Progress (2026-04-26, Session 11 — Promote Runners to Top-Level Navigation)

- Promoted Runners from Settings > Infrastructure to top-level navigation in both web and desktop apps
- Runners now appears in the main sidebar alongside Sessions and Library (order: New Session, Library, Runners, [separator], Recents)
- Removed "Infrastructure" group from `SETTINGS_NAV_GROUPS` in `@stigmer/react` — remaining groups are genuinely settings concerns
- Moved `RunnersSection` from `domain/settings/` to `domain/runner/` following domain-based organization
- Created new top-level `/runners` route in web (Next.js page) and desktop (hash route)
- Added backward-compatible redirects from `/settings/runners` in both apps
- All verification targets pass: SDK lint + typecheck (clean), web lint (clean), desktop lint + typecheck + cargo check (0 errors, 9 pre-existing warnings)
- Commit: `076575038 feat(sdk,web,desktop): promote Runners from Settings to top-level navigation`

## Session Progress (2026-04-26, Session 10 — T03 Web App Migration & Project Close-Out)

- Completed T03: Web App Migration — cleanup, parity verification, and project close-out
- T03-A: Deleted 6 dead `_shared/ui/` files (badge, card, dialog, table, collapsible, error-message) — zero consumers confirmed via grep
- T03-B: Cross-app feature parity verified — all library pages (list + detail for agents, skills, MCP servers) and all settings pages are structurally identical across web and desktop, differing only in framework-specific routing (Next.js vs react-router)
- T03-C: Import hygiene clean — all 25 `@/domain/_shared/` imports in the web app are correctly local (Console design primitives, shell components, Next.js hooks); zero redundant re-exports of SDK symbols remain after `error-message.tsx` deletion
- T03-D: All verification targets pass: SDK lint + typecheck (clean), web lint (clean), desktop lint + typecheck + cargo check (0 errors, 9 pre-existing warnings in untouched files)

**Project is complete.** All three tasks (T01: SDK extraction, T02: Desktop shell rebuild, T03: Web app migration) are done. Both apps have full UX parity and consume shared SDK components.

## Session Progress (2026-04-26, Session 9 — Desktop Library Feature Parity)

- Closed all five library feature gaps between desktop and web console
- Added page headers (title, description, "Add" action) to AgentListPage, SkillListPage, McpServerListPage
- Added localStorage scope persistence using same `stigmer:library:{type}:scope` key convention as web
- Added McpServerConnectDialog with per-card connect button via renderItemAction to McpServerListPage
- Wired useUpdateVisibility into AgentDetailPage, SkillDetailPage, McpServerDetailPage — detail views now show interactive VisibilityToggle instead of read-only badge
- Added Edit button to AgentDetailPage navigating to `/?draft=agent&editOrg=...&editSlug=...`
- All changes are pure wiring — no new SDK components needed, all building blocks already existed in `@stigmer/react`
- All verification targets pass: desktop lint + typecheck + cargo check (0 errors, 9 pre-existing warnings in untouched files)
- Commit: `30a3d8ba9 feat(desktop): add library feature parity with web console`

**All library feature gaps from T02 duplication audit are now closed.** Desktop library pages now have full parity with web:
- List pages: page headers, scope persistence, search, pagination, MCP connect dialog
- Detail pages: interactive visibility toggle, agent edit button, breadcrumb name override

## Session Progress (2026-04-26, Session 8 — Native App Menu Bar)

- Added native macOS app menu bar via new `menu.rs` Rust module
- About Stigmer dialog now shows the Stigmer app icon, version from `tauri.conf.json`, and copyright — replaces the default Tauri about panel that showed "stigmer-desktop" with a generic folder icon
- Added "Check for Updates..." to the app menu, reusing the existing `check-for-update` Tauri event (zero frontend changes)
- Added standard Edit submenu (Undo/Redo/Cut/Copy/Paste/Select All) and Window submenu (Minimize/Close Window)
- Wired into `lib.rs` with `mod menu;`, `.on_menu_event()` handler, and `setup_app_menu(app)?;` in setup
- Fixed PredefinedMenuItem labels: `.about()`, `.hide()`, `.quit()` convenience methods defaulted to macOS process name ("stigmer-desktop"); switched to explicit `PredefinedMenuItem::about/hide/quit` with custom text overrides so menu reads "About Stigmer", "Hide Stigmer", "Quit Stigmer" in both dev and production
- All verification targets pass: `make verify-desktop` clean (0 errors, 0 new warnings)

## Session Progress (2026-04-26, Session 7 — T02 Desktop Shell Rebuild)

- Completed T02-A: Sidebar collapse infrastructure — `useSidebarOpen()` hook with localStorage persistence, AppShell width transition + reopen button
- Completed T02-B: Desktop UserMenu bridge — `useColorModePreference()` hook persisting to localStorage, `UserMenu.tsx` bridge mapping auth/theme/routing to SDK props, `App.tsx` wired to read color mode preference
- Completed T02-C: Rebuilt Sidebar with OrgSwitcher (top row with collapse toggle), UserMenu (bottom), session recents, version footer preserved as desktop-specific element
- Completed T02-D: ManagementSidebar with `SETTINGS_NAV_GROUPS` nav items, OrgSwitcher, "Back to Sessions", UserMenu; AppShell zone switching (`/settings` → ManagementSidebar, else → Sidebar)
- Completed T02-E: Settings landing page at `/settings` with nav group cards, SettingsLayout with `<Outlet />` + centered container
- **Extracted 9 settings Section components to SDK** (`sdk/react/src/settings/`): ApiKeysSection, MembersSection, OrgProfileSection, EnvironmentsSection, InvitationsSection, IdentityProvidersSection (with `ssoLoginBaseUrl` prop), PlatformClientsSection, OAuthAppsSection, UsageSection
- Migrated web settings pages to import directly from `@stigmer/react` — deleted 9 `domain/settings/` files
- Desktop settings routes reference SDK sections directly in `routes.tsx` — eliminated 9 thin wrapper files
- SettingsRunners and SettingsBilling remain app-specific (Tauri runner management, coming-soon placeholder)
- Completed T02-G: Library breadcrumbs — `LibraryBreadcrumb.tsx`, `LibraryLayout.tsx` with `<Outlet />`, detail pages call `useBreadcrumbOverride().setLabel()`
- **Extracted `LibraryBreadcrumbContext`** (provider + hooks) to `sdk/react/src/library/` — both apps import from `@stigmer/react`
- Ran duplication audit across all desktop `pages/library/` and `pages/settings/` — identified remaining files as either correct thin-wrapper architecture (DD-004) or feature gaps (not duplication)
- All verification targets pass: SDK lint + typecheck, web lint, desktop typecheck
- Commit: `bd4c3446f refactor(sdk,desktop,web): rebuild desktop app shell and extract settings sections to SDK`

**T02 core is complete.** Desktop now has:
- Sidebar with OrgSwitcher, UserMenu, collapse toggle, session recents, version footer
- ManagementSidebar with SETTINGS_NAV_GROUPS navigation for settings zone
- 11 settings pages (9 from SDK sections + runners + billing placeholder)
- Settings landing page at `/settings`
- Library breadcrumbs with resource name override
- Color mode toggle (light/dark/system) persisted to localStorage

**All feature gaps from the duplication audit are now closed** (Session 9).

## Session Progress (2026-04-26, Session 6 — T01-E)

- Completed T01-E: Extracted `UserMenu` component to `sdk/react/src/user/UserMenu.tsx`
- Discovered architectural surprise: `useColorMode()` is read-only (returns resolved `"light"` | `"dark"`, no setter) — the T01 plan assumed it could control color mode
- Resolved with controlled `colorMode` + `onColorModeChange` props on UserMenu, following the callback-based pattern from `OrgSwitcher.onOrgChanged` (DD-004)
- Added `MenuGroup` and `MenuLabel` primitives to `sdk/react/src/internal/menu.tsx` for section headers
- Flattened color scheme into main menu body (3 radio items, no submenu) — Hick's Law: 3 items don't justify an extra interaction layer
- Removed preset picker from UserMenu per T01 plan decision ("No preset picker — color mode switching only")
- Rewrote web `UserMenu.tsx` as thin Console bridge (~45 lines, down from 234) — maps `next-themes` → `colorMode`/`onColorModeChange`, `useAuth` → `user`/`onSignOut`, `useRouter` → `onSettingsClick`
- Web's `DesktopAppItem` passed via `extraItems` slot — `DropdownMenuItem` compatible with SDK's `@base-ui/react` Menu context
- Preserved existing import paths: zero changes to `Sidebar.tsx` and `ManagementSidebar.tsx`
- Created `sdk/react/src/user/index.ts` barrel, updated `sdk/react/src/index.ts`
- All verification targets pass: SDK lint + typecheck, web lint, desktop lint + typecheck + cargo check
- 4 pre-existing warnings in `SettingsRunners.tsx` (opacity modifier tokens, untouched files)
- Commit: `92a2b85d8 refactor(sdk,web): extract UserMenu to @stigmer/react`

**T01 is now complete.** All 5 subtasks (A through E) are done. The SDK now contains:
- `sdk/react/src/organization/OrgProvider.tsx` — OrgProvider, useOrg, useActiveOrgSlug
- `sdk/react/src/organization/useOrgGate.ts` — useOrgGate behavior hook
- `sdk/react/src/organization/OrgSwitcher.tsx` — OrgSwitcher component
- `sdk/react/src/settings/settings-nav.ts` — SETTINGS_NAV_GROUPS, SettingsNavItem, SettingsNavGroup
- `sdk/react/src/user/UserMenu.tsx` — UserMenu component

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

All planned tasks are complete. Potential follow-up work (not part of this project):

1. **Visual testing** — end-to-end visual testing of the rebuilt desktop shell
2. **Pre-existing lint warnings** — 9 warnings in `SettingsRunners.tsx` (opacity modifiers) and `AppShell.tsx` (sidebar token context) in the desktop app, all pre-existing in untouched files

## Context for Resume

- **T01 and T02 core are complete.** All subtask plans are in `tasks/T01_0_plan.md` and `.cursor/plans/`
- T01-E plan is in `.cursor/plans/t01-e_usermenu_extraction_0247330e.plan.md` — documents the color mode control gap, flattened menu decision, and Console wrapper pattern
- SDK-internal Menu primitives live in `sdk/react/src/internal/menu.tsx` — includes Menu, MenuTrigger, MenuContent, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuGroup, MenuLabel
- UserMenu uses controlled `colorMode` + `onColorModeChange` props — `useColorMode()` is read-only, so color mode mutation is the consumer's responsibility (web bridges via `next-themes`, desktop bridges via its own state)
- UserMenu `extraItems` slot accepts `React.ReactNode` — items should be `@base-ui/react` Menu.Item elements for keyboard navigation and ARIA compatibility
- Web `UserMenu.tsx` is now a thin Console bridge (not deleted) — preserves import paths in Sidebar.tsx and ManagementSidebar.tsx
- Preset picker was removed from UserMenu per plan — can be reintroduced later as `extraItems` or in a dedicated Appearance settings page
- Settings nav data now lives in `sdk/react/src/settings/settings-nav.ts` — T02 desktop management sidebar imports from `@stigmer/react`
- `lucide-react` is a declared peer dependency of `@stigmer/react` (>=0.400.0, non-optional)
- The `onOrgChanged` callback on `OrgSwitcher` fires only on user-initiated org changes — it does NOT fire on initial load or background refresh; this is the right primitive for "navigate on org switch"
- Desktop has `@base-ui/react` as a dependency — ready for T02
- Token context correctness pattern: trigger elements use sidebar-* tokens, portaled dropdown/dialog content uses popover-*/main-area tokens, with eslint-disable blocks + justification for portaled sections
- Key pattern established: SDK org hooks import from `../hooks` (relative), both client apps import from `@stigmer/react` (package)
- The `useOrgGate()` hook follows DD-003 (headless-first) and DD-004 (zero framework deps in SDK) — consumer computes routing/auth inputs, hook manages pure state machine

## Quick Commands

After loading context:
- "Start T02" - Begin the Desktop App Shell Rebuild
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
