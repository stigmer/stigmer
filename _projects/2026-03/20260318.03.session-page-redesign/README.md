# Project: 20260318.03.session-page-redesign

## Overview
Redesign the session/execution detail page to eliminate the right sidebar (ContextPanel), replace it with compact metadata widgets floating within the main content area, and restyle the FollowUpInput to match the SessionLauncher's visual language. Inspired by Claude Code's single-canvas layout.

**Created**: 2026-03-18
**Status**: Active 🟢

## Project Information

### Primary Goal
Achieve a single-canvas session page where the conversation thread, metadata widgets, and follow-up input are distinct components placed on one unified surface — no separate right panel.

### Timeline
**Target Completion**: 1 week

### Technology Stack
TypeScript/React, @stigmer/react SDK, @stigmer/theme tokens, client-apps/web Next.js Console

### Project Type
Refactoring

### Affected Components
@stigmer/react execution components (MessageThread, FollowUpInput, ExecutionDetails), client-apps/web layout (AppShell, ContextPanel, SessionPage), @stigmer/theme tokens

## Project Context

### Dependencies
None identified

### Success Criteria
- 1. Right sidebar (ContextPanel) removed from AppShell. 2. Session page renders metadata (status
- workspace) as compact top-right widgets within the main content area. 3. FollowUpInput visually matches SessionLauncher style (rounded-xl
- border
- bg-card
- shadow). 4. Single background canvas with components at specific positions. 5. All changes work in both Console and embedded SDK contexts.

### Known Risks & Mitigations
1. Removing ContextPanel affects the slot mechanism used by SessionPage — requires clean removal of useContextPanelSlot. 2. ExecutionDetails component is currently designed for sidebar layout — needs decomposition into smaller widget components. 3. FollowUpInput is an SDK component — changes must work for platform builders embedding it outside the Console.

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