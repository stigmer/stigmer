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
**Current Task**: T01-C (Extract OrgSwitcher component to SDK)
**Status**: In Progress

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

1. **T01-C**: Extract `OrgSwitcher` component to SDK
2. **T01-D**: Move `SETTINGS_NAV_GROUPS` to SDK
3. **T01-E**: Extract `UserMenu` to SDK

## Context for Resume

- T01 plan is in `tasks/T01_0_plan.md` — the full task breakdown with all subtask details
- T01-B plan is in `.cursor/plans/t01-b_useorggate_extraction_06b71855.plan.md` — detailed design rationale for the discriminated union API
- The source file for T01-C is `client-apps/web/src/domain/_shared/layout/OrgSwitcher.tsx` — uses `useOrg()` (now from SDK) and `CreateOrganizationForm` (already in SDK)
- Key pattern established: SDK org hooks import from `../hooks` (relative), both client apps import from `@stigmer/react` (package)
- Desktop has no `@base-ui/react` dependency; web does. T01-C needs `@base-ui/react` Menu primitives — desktop will need it added as a dependency
- The `useOrgGate()` hook follows DD-003 (headless-first) and DD-004 (zero framework deps in SDK) — consumer computes routing/auth inputs, hook manages pure state machine
- Established type pattern: `OrgGateState` uses `status` as discriminant field, matching `AgentSetupPhase`/`McpServerSetupPhase` convention

## Quick Commands

After loading context:
- "Continue with T01-C" - Pick up the next subtask
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
