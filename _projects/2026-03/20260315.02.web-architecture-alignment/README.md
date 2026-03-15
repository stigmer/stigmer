# Project: 20260315.02.web-architecture-alignment

## Overview
Close the architectural and UX gaps in Stigmer Web — adopt Query/Command hook pattern, Bridge IoC, error handling framework, domain library decomposition, clean up dead code, and bring the web console UX to state-of-the-art standards (visual identity, navigation IA, view completeness, information density).

**Created**: 2026-03-15
**Status**: Active 🟢

## Project Information

### Primary Goal
Bring Stigmer Web to the same level of architectural consistency as Planton Web **and** the same level of UX polish as Temporal's web console, ensuring every feature follows predictable patterns and every view meets usability heuristics.

### Timeline
**Target Completion**: ~4 weeks (9 phases, 21 tasks)

### Technology Stack
TypeScript/React/Next.js 16

### Project Type
Refactoring + UX

### Affected Components
client-apps/web/src/ (hooks, services, components, layouts, pages), client-apps/web/_libs/ (domain packages, rpc-client, theme)

## Project Context

### Dependencies
Planton Web as architecture reference; Temporal Web as UX benchmark; @stigmer/protos must be stable

### Success Criteria — Architecture
- (1) All dead code removed
- (2) Prettier configured
- (3) Routing bug fixed
- (4) `@stigmer/react-ui` renamed to `@stigmer/execution-ui`
- (5) Query/Command hook pattern adopted for all resources
- (6) Error handling bridge added
- (7) At least 2 domain packages extracted beyond execution-ui

### Success Criteria — UX
- (8) Brand color system applied (not monochrome gray)
- (9) Dark mode functional with toggle
- (10) Navigation IA decided and documented
- (11) Global header with user profile, search, notifications
- (12) Sidebar redesigned per IA decision
- (13) Breadcrumbs on all detail pages
- (14) Sessions page fully functional (not empty)
- (15) Dashboard shows system status (not just actions)
- (16) Table/grid toggle on resource lists
- (17) Workflow views present (list + detail stub)
- (18) Settings/IAM views present (org, envs, API keys)

### Known Risks & Mitigations
Breaking existing consumers of @stigmer/react-ui during rename; scope creep from pattern adoption touching every file; visual identity changes breaking existing views; Phase 8 (Workflows, IAM) being too large — mitigated by making it independently deferrable

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