# Project: 20260303.02.cli-tui-ux-hardening

## Overview
Comprehensive hardening of the Stigmer CLI/TUI execution pipeline — fixing approval flow gaps, error handling, stream resilience, terminal degradation, stdout/stderr discipline, and UX polish across the draft, run, and discover commands.

**Created**: 2026-03-03
**Status**: Active 🟢

## Project Information

### Primary Goal
Eliminate all identified UX gaps in the CLI/TUI so that every user interaction is resilient, informative, and recoverable — zero leaked errors, zero silent hangs, zero broken terminal states.

### Timeline
**Target Completion**: Ongoing / no hard deadline

### Technology Stack
Go, Bubbletea (charmbracelet), gRPC, Cobra

### Project Type
Bug Fix

### Affected Components
client-apps/cli/cmd/stigmer/root (run, draft, discover commands), client-apps/cli/pkg/executiontui (TUI model, events, approval, blocks), client-apps/cli/internal/cli/clierr (error handling), client-apps/cli/pkg/approval (approval prompts)

## Project Context

### Dependencies
None — all changes are CLI-side, no backend changes required for most gaps

### Success Criteria
- 1) Approval prompt appears on every resume path including snapshot. 2) No raw gRPC/internal errors leak to user. 3) Dead stream connections are detected within 30s. 4) TUI degrades gracefully to non-interactive output in dumb terminals/pipes. 5) All errors include what/why/how-to-fix. 6) Exit codes differentiate error categories.

### Known Risks & Mitigations
1) Bubbletea alt-screen TUI has limited fallback options. 2) Approval channel deadlock fix may require careful buffer tuning. 3) Signal handling across platforms (darwin/linux) needs testing.

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