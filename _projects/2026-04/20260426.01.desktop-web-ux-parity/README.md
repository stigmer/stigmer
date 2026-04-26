# Project: 20260426.01.desktop-web-ux-parity

## Overview
Align the Stigmer desktop app UX to match the web console by extracting shared components (OrgProvider, OrgSwitcher, UserMenu, settings nav) into @stigmer/react, rebuilding the desktop app shell with org context switching, management sidebar, user menu, full settings surface, and library breadcrumbs, then migrating the web app to consume the same SDK components.

**Created**: 2026-04-26
**Status**: Active 🟢

## Project Information

### Primary Goal
Users should have an identical experience when using the web app and the desktop app. Eliminate UX gaps (missing org switcher, incomplete settings, no user menu, no sidebar collapse, no library breadcrumbs) and eliminate duplicated code between the two client apps.

### Timeline
**Target Completion**: No specific deadline — quality over speed

### Technology Stack
TypeScript, React 19, @stigmer/react SDK, @stigmer/theme, @base-ui/react, Tauri v2 (desktop), Next.js 16 (web), react-router-dom v7 (desktop), Vite 6 (desktop)

### Project Type
Refactoring

### Affected Components
sdk/react (shared SDK extractions), client-apps/desktop (app shell rebuild), client-apps/web (migration to shared SDK components)

## Project Context

### Dependencies
@stigmer/react already exports feature panels (RunnerListPanel, ApiKeyListPanel, InvitationManager, etc.) that desktop pages consume. @base-ui/react is already an optional peer dep of @stigmer/react.

### Success Criteria
1. Desktop sidebar has OrgSwitcher, UserMenu, sidebar collapse — matching web
2. Desktop has all 11 settings pages (matching web)
3. Desktop has ManagementSidebar for settings zone
4. Desktop has library breadcrumb navigation
5. OrgProvider, OrgSwitcher, settings-nav, UserMenu live in `@stigmer/react` (no duplication)
6. Web app migrated to consume SDK components
7. Both apps pass `make check`

### Known Risks & Mitigations
1) Breaking existing desktop or web functionality during extraction. 2) @base-ui/react dropdown/dialog API differences between SDK and web app wrapper usage. 3) react-router vs next/navigation routing abstraction in shared components. 4) Potential bundle size increase in desktop from new @base-ui/react dependency.

## Project Structure

This project follows the **Next Project Framework** for structured multi-day development:

- **`tasks/`** - Detailed task planning and execution logs (update freely)
- **`checkpoints/`** - Major milestone summaries (⚠️ ASK before creating)
- **`design-decisions/`** - Significant architectural choices (⚠️ ASK before creating)
- **`coding-guidelines/`** - Project-wide code standards (⚠️ ASK before creating)
- **`wrong-assumptions/`** - Important misconceptions (⚠️ ASK before creating)
- **`dont-dos/`** - Critical anti-patterns (⚠️ ASK before creating)

**📌 IMPORTANT**: Knowledge folders require developer permission. See [coding-guidelines/documentation-discipline.md](coding-guidelines/documentation-discipline.md)

## Current Status

### Active Task
See [tasks/](tasks/) for the current task being worked on.

### Latest Checkpoint
See [checkpoints/](checkpoints/) for the most recent project state.

### Progress Tracking
- [x] Project initialized
- [x] Gap analysis complete (planning session)
- [x] Design decisions resolved (planning session)
- [ ] T01: SDK extraction (OrgProvider, useOrgGate, OrgSwitcher, settings-nav, UserMenu)
  - [x] T01-A: Extract OrgProvider + useOrg + useActiveOrgSlug to SDK
- [ ] T02: Desktop app shell rebuild (sidebar, management sidebar, settings pages, library breadcrumbs)
- [ ] T03: Web app migration to SDK components
- [ ] Verification: both apps pass `make check`
- [ ] Project completed

## How to Resume Work

**Quick Resume**: Simply drag and drop the `next-task.md` file into your AI conversation.

The `next-task.md` file contains:
- Direct paths to all project folders
- Current status information
- Resume checklist
- Quick commands

## Quick Links

- [Next Task](next-task.md) - **Drag this into chat to resume**
- [Current Task](tasks/)
- [Latest Checkpoint](checkpoints/)
- [Design Decisions](design-decisions/)
- [Coding Guidelines](coding-guidelines/)

## Documentation Discipline

**CRITICAL**: AI assistants must ASK for permission before creating:
- Checkpoints
- Design decisions
- Guidelines
- Wrong assumptions
- Don't dos

Only task logs (T##_1_feedback.md, T##_2_execution.md) can be updated without permission.

## Notes

_Add any additional notes, links, or context here as the project evolves._