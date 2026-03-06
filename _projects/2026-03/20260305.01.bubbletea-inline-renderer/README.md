# Project: 20260305.01.bubbletea-inline-renderer

## Overview
Rewrite the Stigmer CLI inline renderer to use Bubbletea inline mode (no alt screen), replacing all manual ANSI cursor math (lineCountingWriter, termctl.EraseLines, raw escape sequences) with Bubbletea framework-managed rendering. Preserves every existing UX decision (compact tool rendering, approval panels, streaming collapse, thinking spinner, follow-up prompts).

**Created**: 2026-03-05
**Status**: Active 🟢

## Project Information

### Primary Goal
Eliminate fragile manual cursor tracking in favor of Bubbletea built-in row management so all in-place terminal updates (subject replacement, approval collapse, tool streaming, follow-up prompt) work correctly regardless of terminal width, wrapping, or interleaved output.

### Timeline
**Target Completion**: Flexible -- get it right over getting it fast

### Technology Stack
Go / Bubbletea (charmbracelet) -- already a dependency

### Project Type
Refactoring

### Affected Components
cmd/stigmer/root/run_stream_inline*.go, cmd/stigmer/root/run_stream_inline_approval.go, cmd/stigmer/root/run_stream_inline_streaming.go, cmd/stigmer/root/run_stream_inline_followup.go, cmd/stigmer/root/run_stream_inline_header_update.go, pkg/approval/inline_prompter.go, pkg/spinner/, pkg/termctl/

## Project Context

### Dependencies
Bubbletea (already in go.mod), charmbracelet/x/ansi (already imported), lipgloss (already used for styling)

### Success Criteria
- 1) All in-place updates work correctly regardless of terminal width/wrapping. 2) Zero UX regression -- every visual element (dot prefix
- compact tool names
- approval panels
- streaming content
- thinking spinner
- follow-up prompt) stays identical. 3) lineCountingWriter
- manual ANSI cursor sequences
- and termctl.EraseLines calls in inline renderer are eliminated. 4) JSON output mode (--json) continues to work unchanged.

### Known Risks & Mitigations
1) UX regression risk -- many subtle visual decisions baked into current rendering. 2) Bubbletea inline mode behavior with stdout/stderr separation. 3) Follow-up input loop needs careful Bubbletea lifecycle management. 4) Performance with long sessions (re-rendering active region).

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