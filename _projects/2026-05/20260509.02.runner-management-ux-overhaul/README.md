# Project: 20260509.02.runner-management-ux-overhaul

## Overview
Overhaul runner management UX to make local execution invisible and idempotent. Replace the 'Start Runner' modal with a reconciled desired-state model where the desktop app auto-adopts existing runners, treats 'already running' as success, and exposes status rather than process-creation forms.

**Created**: 2026-05-09
**Status**: Active 🟢

## Project Information

### Primary Goal
Make runner lifecycle invisible to desktop users. A user should never see 'runner already running' as an error. The target UX is: when Stigmer Desktop is open and the user is signed in, this computer is available for Stigmer runs unless the user disables it.

### Timeline
**Target Completion**: Ongoing / no hard deadline — phased delivery

### Technology Stack
Go CLI, TypeScript/React desktop (Tauri), Rust sidecar, Proto/gRPC backend (Java), systemd/launchd

### Project Type
Feature Development

### Affected Components
client-apps/cli (runner package), client-apps/desktop (RunnersPage, StartRunnerDialog, Tauri sidecar), sdk/react (runner hooks), backend runner service (stigmer-cloud), proto definitions (runner/v1)

## Project Context

### Dependencies
None — can be implemented incrementally phase by phase

### Success Criteria
- 1) 'stigmer up' when runner already running exits 0 with success message. 2) Desktop app auto-adopts existing runner without showing error. 3) Stable machine_id replaces hostname-slug as identity key. 4) Local control socket enables cross-process adoption. 5) Desktop shows status card instead of Start Runner modal. 6) Service install available for macOS/Linux persistence.

### Known Risks & Mitigations
1) Breaking change to CLI exit codes may affect automation scripts. 2) machine_id migration for existing users. 3) Server-side RunnerSession model requires cloud backend changes. 4) LaunchAgent/systemd integration needs platform-specific testing.

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