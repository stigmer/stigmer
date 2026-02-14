# Project: 20260214.02.cli-interactive-execution-viewer

## Overview
Build a Bubbletea-based interactive TUI that replaces the current linear stdout streaming renderer in the Stigmer CLI. Users can scroll back through agent execution output and expand/collapse tool call results (file reads, directory listings, search results) while the agent streams. Integrates the approval prompt into the same Bubbletea model.

**Created**: 2026-02-14
**Status**: Active 🟢

## Project Information

### Primary Goal
Replace the messageStreamRenderer (linear stdout writer) with a full Bubbletea TUI that provides scrollback, keyboard navigation, and expand/collapse for all tool call results during agent execution streaming.

### Timeline
**Target Completion**: Flexible - quality over speed

### Technology Stack
Go, Bubbletea (charmbracelet/bubbletea), Bubbles (charmbracelet/bubbles - viewport, key), Lipgloss (charmbracelet/lipgloss)

### Project Type
Feature Development

### Affected Components
client-apps/cli/pkg/toolrender/ (tool rendering with expand/collapse state), client-apps/cli/cmd/stigmer/root/run_display_stream.go (messageStreamRenderer replacement), client-apps/cli/cmd/stigmer/root/run_stream.go (gRPC stream loop integration), client-apps/cli/pkg/approval/ (approval prompt integration into TUI model), client-apps/cli/cmd/stigmer/root/run_display_tools.go (tool call conversion)

## Project Context

### Dependencies
None - all required libraries (bubbletea, bubbles, lipgloss) are already in go.mod

### Success Criteria
- 1. Full TUI with scrollback and keyboard navigation during agent execution streaming. 2. Expand/collapse for all tool call results (reads
- ls
- glob
- grep). 3. Approval prompt integrated as a sub-state within the Bubbletea model. 4. Feature parity with current output (all message types render correctly). 5. Smooth streaming experience - auto-scroll to bottom on new content
- stop when user scrolls up. 6. No regressions in the critical streaming UX path.

### Known Risks & Mitigations
1. Approval prompt integration - currently a separate Bubbletea program, needs to become a sub-state within the TUI model. 2. Streaming + user interaction dance - auto-scroll vs user scroll-back behavior needs careful handling. 3. Regression risk - the streaming display is a critical UX path used in every agent execution. 4. Terminal compatibility - Bubbletea alt-screen vs inline rendering tradeoffs.

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