# Project: 20260304.02.inline-first-cli

## Overview
Move Stigmer CLI from alt-screen TUI default to inline-first terminal experience inspired by Claude Code. Compact tool rendering (read as filename+line count, write/edit with previews, grouped sub-agents), inline follow-up input, and streamlined approval prompts — all in normal terminal scrollback without alt-screen.

**Created**: 2026-03-04
**Status**: Active 🟢

## Project Information

### Primary Goal
Make the inline rendering mode the default CLI experience with four perfected UI surfaces: (1) Read tool as compact filename+line count, (2) Write/Edit tool with appropriate previews, (3) Sub-agent tool grouping, and (4) Streamlined approval prompts. Keep alt-screen TUI as opt-in via --tui flag.

### Timeline
**Target Completion**: Flexible / no hard deadline

### Technology Stack
Go, Bubbletea (charmbracelet), gRPC, Cobra

### Project Type
Refactoring

### Affected Components
client-apps/cli/cmd/stigmer/root (run_stream_inline.go, output_mode.go, run_stream.go), client-apps/cli/pkg/executiontui (model.go, render_blocks.go, view.go), client-apps/cli/pkg/toolrender (file_preview.go, render.go)

## Project Context

### Dependencies
Builds on Phase 2.2 (Two-Lane Output) from the cli-tui-ux-hardening project which already created the inline renderer

### Success Criteria
- 1. Default mode (TTY) renders inline without alt-screen. 2. Read tools show as one-line filename+count. 3. Write/Edit tools show compact preview. 4. Sub-agent tools are grouped under a header. 5. Approval prompts work inline with y/n/e/Esc. 6. Follow-up input works after completion. 7. --tui flag opts into the existing alt-screen TUI.

### Known Risks & Mitigations
1. Inline follow-up input requires a readline implementation outside Bubbletea. 2. Sub-agent grouping may need backend changes if nesting metadata is insufficient. 3. Approval UX in inline mode needs careful terminal state management.

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