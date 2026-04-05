# Project: 20260405.03.settings-layout-refactor

## Overview
Separate the web console into two distinct zones (agent/session zone vs management zone) and split the monolithic settings page into sub-pages with their own sidebar navigation, following the pattern used by Cursor's team management area.

**Created**: 2026-04-05
**Status**: Active 🟢

## Project Information

### Primary Goal
Create a dedicated management zone with its own shell/layout that replaces the session sidebar with a management-specific sidebar when on /settings/** routes. Split Members, API Keys, and Environments into individual routed sub-pages (/settings/members, /settings/api-keys, /settings/environments) with a sidebar nav linking between them. Provide a clear 'Back to Sessions' zone-switch mechanism.

### Timeline
**Target Completion**: No rush / whenever

### Technology Stack
Next.js App Router, React, TypeScript

### Project Type
Refactoring

### Affected Components
client-apps/web/src/components/layout/AppShell.tsx (zone detection/switching), client-apps/web/src/components/layout/Sidebar.tsx (new management sidebar variant), client-apps/web/src/app/settings/ (new layout.tsx + sub-route pages), client-apps/web/src/components/settings/MembersSection.tsx, client-apps/web/src/components/settings/ApiKeysSection.tsx, client-apps/web/src/components/settings/EnvironmentsSection.tsx

## Project Context

### Dependencies
None — the IAM role-permission-separation project that added Members is already complete

### Success Criteria
- Management zone has its own layout with a sidebar nav (not the session sidebar)
- Settings split into `/settings/members`, `/settings/api-keys`, `/settings/environments` sub-routes
- Clear "Back to Sessions" escape hatch from the management zone
- Existing session navigation and Library routing unaffected
- Deep-linking to individual settings sections works

### Known Risks & Mitigations
Breaking existing session sidebar navigation and SessionNavigationProvider state. Ensuring OrgSwitcher works in both zone sidebars. Mobile responsiveness for the management sidebar. Maintaining the sidebar open/close state across zone transitions.

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
- [ ] Initial analysis complete
- [ ] Core implementation
- [ ] Testing and validation
- [ ] Documentation finalized
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