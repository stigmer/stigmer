# Project: 20260305.02.expand-collapse-tools

## Overview
Build an event history + clear+re-commit mechanism for the Stigmer CLI inline renderer. Enables: (1) session header subject update without ANSI cursor math, (2) expand/collapse toggle for tool executions similar to Claude Code's Ctrl+O, (3) read-file group expansion, and (4) a general-purpose re-render capability for future triggers (terminal resize, theme toggle).

**Created**: 2026-03-05
**Status**: Active 🟢

## Project Information

### Primary Goal
Retain structured event data in the Bubbletea model so the entire session can be re-rendered on demand. First use case: session header subject update (restoring the feature deleted in Phase 3 of the Bubbletea migration). Primary use case: Ctrl+O expand/collapse toggle for tool calls and read-file groups.

### Timeline
**Target Completion**: No specific deadline -- follow-on project after Bubbletea migration completes

### Technology Stack
Go / Bubbletea (charmbracelet)

### Project Type
Feature Development

### Affected Components
inline renderer (run_stream_inline*.go), Bubbletea model (run_stream_inline_bubbletea.go), toolrender package, model state retention, key binding handling

## Project Context

### Dependencies
Depends on completion of 20260305.01.bubbletea-inline-renderer project (Bubbletea migration must be done first)

### Success Criteria
- Session header Subject field is restored — renders blank initially, updates in-place when resolved via clean clear+re-commit (no ANSI cursor math)
- Users can press a keybinding (e.g. Ctrl+O) to toggle all tool call renderings between compact and expanded views
- Read-file group collapses also expand
- Toggle works for both already-committed and active-view content via clear+re-commit strategy
- Performance acceptable for sessions with 100+ tool calls (< 500ms re-commit)

### Known Risks & Mitigations
Performance of clear+re-commit for very long sessions. Interaction with ongoing AI streaming during toggle. Terminal compatibility for clear-screen operations. Model must retain all structured event data (not just rendered strings).

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