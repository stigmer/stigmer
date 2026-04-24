# Project: 20260423.01.web-sdk-architecture-standards

## Overview
Codify stigmer web/SDK architectural standards inspired by planton refactoring practices -- document design decisions and dont-dos, reorganize the web console by domain to enforce SDK-first thin-shell discipline, and establish measurable architectural health metrics.

**Created**: 2026-04-23
**Status**: Active 🟢

## Project Information

### Primary Goal
Establish formal design decisions for the SDK-first web architecture, restructure client-apps/web/src/ to mirror SDK domain modules with app/ as routes-only, and add ESLint rules and metrics to track architectural health quantitatively.

### Timeline
**Target Completion**: 1-2 weeks

### Technology Stack
TypeScript/React, Next.js, ESLint, @stigmer/react, @stigmer/sdk, @stigmer/theme

### Project Type
Refactoring

### Affected Components
client-apps/web/src (console), sdk/react (SDK domain modules), .cursor/rules (architecture rules), docs/ (design decisions)

## Project Context

### Dependencies
None -- this is documentation and reorganization work, no external dependencies

### Success Criteria
- Design decisions documented as numbered DDs
- Console src/ restructured by domain with app/ routes-only
- ESLint rules enforcing SDK/console boundary
- Architectural metrics baseline established

### Known Risks & Mitigations
Console restructuring may temporarily break import paths, Need to coordinate with any in-flight web console feature work

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