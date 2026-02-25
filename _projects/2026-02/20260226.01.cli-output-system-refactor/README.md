# Project: 20260226.01.cli-output-system-refactor

## Overview
Refactor the Stigmer CLI output layer from ad-hoc fmt.Println calls into a structured, domain-driven output system with consistent formatting, proper confirmation prompts, and machine-readable output support.

**Created**: 2026-02-26
**Status**: Active 🟢

## Project Information

### Primary Goal
Replace the current anemic CLI output model with a structured CommandResult domain entity, a Renderer interface (Human/JSON/Quiet), fix the destructive delete-without-confirmation bug, consolidate 8 duplicate display.go files into a generic resource renderer, and establish a strict icon/semantic vocabulary.

### Timeline
**Target Completion**: Ongoing / no fixed deadline

### Technology Stack
Go (Golang), cobra CLI framework, charmbracelet/lipgloss, charmbracelet/bubbletea, fatih/color

### Project Type
Refactoring

### Affected Components
client-apps/cli/internal/cli/cliprint, client-apps/cli/internal/cli/clierr, client-apps/cli/internal/cli/*/display.go (8 files), client-apps/cli/cmd/stigmer/root/*.go (command handlers), client-apps/cli/pkg/display

## Project Context

### Dependencies
None - self-contained CLI refactor with no external blockers

### Success Criteria
- 1. Every command returns a structured CommandResult
- never calls fmt.Print directly. 2. Delete operations require actual y/N confirmation. 3. Single icon/semantic vocabulary across all commands. 4. Global --output flag supports human/json/quiet modes. 5. 8 display.go files consolidated into one generic renderer. 6. Zero deprecated API usage. 7. All status/progress output goes to stderr
- data to stdout.

### Known Risks & Mitigations
1. Big-bang migration touching many files increases merge conflict risk. 2. Behavioral change in delete confirmation may surprise existing scripts/automation. 3. Changing stderr/stdout separation may break existing piping workflows.

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