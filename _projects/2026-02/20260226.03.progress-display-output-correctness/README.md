# Project: 20260226.03.progress-display-output-correctness

## Overview
Make ProgressDisplay a well-behaved citizen in the CLI output system by redirecting BubbleTea output to stderr and adding --json/--quiet flag support to the two remaining mutating commands (server start, server llm pull).

**Created**: 2026-02-26
**Status**: Active 🟢

## Project Information

### Primary Goal
Ensure all mutating CLI commands have consistent output behavior: structured data to stdout, ephemeral progress to stderr, and --json/--quiet flag support for scriptability.

### Timeline
**Target Completion**: 1-2 sessions

### Technology Stack
Go (Golang), cobra CLI framework, charmbracelet/bubbletea, charmbracelet/lipgloss, clioutput package

### Project Type
Refactoring

### Affected Components
client-apps/cli/internal/cli/cliprint/progress.go, client-apps/cli/cmd/stigmer/root/server.go, client-apps/cli/cmd/stigmer/root/server_llm.go, client-apps/cli/pkg/clioutput, client-apps/cli/cmd/stigmer/root/output_flags.go

## Project Context

### Dependencies
Depends on completed cli-output-system-refactor project (Phase 5 output flags infrastructure, clioutput package, climsg package)

### Success Criteria
- 1) ProgressDisplay writes to stderr not stdout. 2) server start and server llm pull support --json and --quiet flags. 3) --json produces valid parseable JSON CommandResult on stdout. 4) --quiet produces zero stdout. 5) Default human mode behavior unchanged. 6) All existing tests pass.

### Known Risks & Mitigations
BubbleTea tea.WithOutput(os.Stderr) may interact unexpectedly with terminal detection. ProgressDisplay suppression in --json/--quiet mode needs clean lifecycle management (Start/Stop must not leave goroutines hanging).

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