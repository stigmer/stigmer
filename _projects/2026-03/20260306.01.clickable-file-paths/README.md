# Project: 20260306.01.clickable-file-paths

## Overview
Make file paths in tool outputs (Read, Write, Edit, etc.) clickable in the terminal via OSC 8 hyperlinks. Currently, hyperlinks only work for local workspace paths; git workspaces, .stigmer paths, and session artifacts are not resolved.

**Created**: 2026-03-06
**Status**: Active 🟢

## Project Information

### Primary Goal
All file paths displayed in compact tool rendering should be clickable and open the correct local file, regardless of workspace type (local, git) or path origin (.stigmer, workspace-relative).

### Timeline
**Target Completion**: Flexible / no hard deadline

### Technology Stack
Go (BubbleTea TUI, lipgloss), pkg/toolrender/, cmd/stigmer/root/

### Project Type
Feature Development

### Affected Components
pkg/toolrender/hyperlink.go, pkg/toolrender/render_compact.go, cmd/stigmer/root/run.go, cmd/stigmer/root/run_workspace.go, cmd/stigmer/root/run_stream_inline.go

## Project Context

### Dependencies
None identified

### Success Criteria
- 1) Local workspace paths clickable (already works). 2) .stigmer/ prefix paths resolve to ~/.stigmer and are clickable. 3) Git workspace paths resolve to local clones when available. 4) Graceful degradation: unresolvable paths remain plain text.

### Known Risks & Mitigations
BubbleTea tea.Println may strip OSC 8 sequences. Git workspace local-clone detection may be unreliable across OS/path conventions.

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