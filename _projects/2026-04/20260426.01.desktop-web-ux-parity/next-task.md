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
**Current Task**: T01-B (Extract useOrgGate behavior hook to SDK)
**Status**: In Progress

## Session Progress (2026-04-26)

- Completed T01-A: Extracted `OrgProvider`, `useOrg`, `useActiveOrgSlug` from both client apps into `sdk/react/src/organization/OrgProvider.tsx`
- Updated barrel exports in `sdk/react/src/organization/index.ts` and `sdk/react/src/index.ts`
- Migrated 13 desktop consumer files and 21 web consumer files to import from `@stigmer/react`
- Deleted `client-apps/desktop/src/org/OrgProvider.tsx` and `client-apps/web/src/domain/_shared/org/org-context.tsx`
- Dropped unused `useActiveOrg()` alias (zero external consumers)
- All verification targets pass: SDK lint + typecheck, web lint, desktop lint + typecheck + cargo check
- Exported `OrgContextValue` type for platform builders

## Next Steps

1. **T01-B**: Extract `useOrgGate()` behavior hook to `sdk/react/src/organization/useOrgGate.ts`
2. **T01-C**: Extract `OrgSwitcher` component to SDK
3. **T01-D**: Move `SETTINGS_NAV_GROUPS` to SDK
4. **T01-E**: Extract `UserMenu` to SDK

## Context for Resume

- T01-A plan is in `tasks/T01_0_plan.md` — the full task breakdown with all subtask details
- The two source files for T01-B are `client-apps/desktop/src/org/OrgGate.tsx` (uses `useOrg` from SDK now) and `client-apps/web/src/domain/_shared/org/OrgGate.tsx` (also uses `useOrg` from SDK now)
- Key pattern established: SDK org hooks import from `../hooks` (relative), both client apps import from `@stigmer/react` (package)
- Desktop has no `@base-ui/react` dependency; web does. This matters for T01-C (OrgSwitcher)

## Quick Commands

After loading context:
- "Continue with T01-B" - Pick up the next subtask
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
