# Project: 20260228.02.e2e-declarative-workspace

## Overview
End-to-end verification, documentation, and enhancement of the declarative track, workspace provisioning, and platform file isolation projects. Reviews all three as a unified system, converts seedpack into a testable project, adds missing CLI capabilities, and produces customer-facing documentation.

**Created**: 2026-02-28
**Status**: Active 🟢

## Project Information

### Primary Goal
Ensure the entire flow works end-to-end (server bootstrap -> draft -> apply -> run -> workspace provisioning -> file isolation), document it for customers, fix the seedpack flow, and enhance the declarative track to support skill directories.

### Timeline
**Target Completion**: Flexible, iterative - no hard deadline

### Technology Stack
Go (CLI), Python (backend/agent-runner), Protobuf (APIs)

### Project Type
Other

### Affected Components
CLI declarative track, workspace provisioning backend, platform file isolation, seedpack bootstrap, customer documentation

## Project Context

### Dependencies
Three feature branches (declarative track, workspace provisioning, platform file isolation) must be merged or composable

### Success Criteria
- Architecture review complete
- Declarative track handles skill directories
- Seedpack is a proper Stigmer project
- CLI --workspace flag implemented
- End-to-end test passes all 7 scenarios
- Customer documentation published

### Known Risks & Mitigations
Go embed constraint limits seedpack location,Declarative track scanner changes could break existing projects,Three feature branches may have merge conflicts,Chicken-and-egg: seedpack bootstrap needed before draft commands work

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