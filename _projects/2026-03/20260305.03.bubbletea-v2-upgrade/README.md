# Project: 20260305.03.bubbletea-v2-upgrade

## Overview
Upgrade Bubbletea from v1.2.4 to v2.0.x across the Stigmer CLI, then leverage v2 native capabilities (cursor positioning, declarative View, real cursor, advanced keyboard handling) to resolve design compromises and deferred work from projects 01 (bubbletea-inline-renderer) and 02 (expand-collapse-tools).

**Created**: 2026-03-05
**Status**: Active 🟢

## Project Information

### Primary Goal
Complete v2 migration with zero UX regression, then use v2 cursor positioning for the follow-up prompt UX overhaul, replace custom text input with bubbles/textinput v2, and unblock Ctrl+O during follow-up prompt.

### Timeline
**Target Completion**: Flexible -- get it right over getting it fast

### Technology Stack
Go / Bubbletea v2 (charmbracelet) / Lipgloss v2 / Bubbles v2

### Project Type
Migration

### Affected Components
inline renderer (run_stream_inline*.go), Bubbletea model (run_stream_inline_bubbletea.go), keypress handlers, follow-up prompt, approval flow (pkg/approval/), progress display (cliprint/progress.go), panel/toolrender styling packages

## Project Context

### Dependencies
Bubbletea v2.0.1+ (charm.land/bubbletea/v2), Bubbles v2.0.0 (charm.land/bubbles/v2), Lipgloss v2 (charm.land/lipgloss/v2). Predecessor projects 01 and 02 must be complete (they are).

### Success Criteria
- 1) All v1 API usage migrated to v2 equivalents. 2) Follow-up prompt has cursor on input line with footer below (Claude Code quality). 3) bubbles/textinput v2 replaces custom text input buffer. 4) Ctrl+O works during follow-up prompt (deferred limitation resolved). 5) Zero UX regression. 6) All tests pass.

### Known Risks & Mitigations
1) v2 released 9 days ago -- potential early bugs. 2) Lipgloss v2 API changes ripple through 12 styling files. 3) Cursed Renderer behavior differences vs v1 renderer. 4) BUILD.bazel external dependency updates. 5) bubbles/textinput v2 API may differ from v1.

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