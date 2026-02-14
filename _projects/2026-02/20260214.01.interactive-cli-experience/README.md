# Project: 20260214.01.interactive-cli-experience

## Overview
Create a world-class interactive CLI experience for agent and workflow executions, where users have full visibility into what's happening, approval flows are crystal-clear, and streaming is real-time.

**Created**: 2026-02-14
**Status**: Active 🟢

## Project Information

### Primary Goal
Transform the CLI execution UX from opaque and batch-oriented to a polished, interactive, real-time experience that users are proud to use -- with clear approval context, live streaming, structured tool call display, and progress indication.

### Timeline
**Target Completion**: 2-3 weeks

### Technology Stack
Go, gRPC streaming, Survey/Bubbletea TUI, fatih/color

### Project Type
Feature Development

### Affected Components
client-apps/cli/cmd/stigmer/root (run_stream, run_display, run_display_approval, run_stream_approval, draft_skill_handler), client-apps/cli/pkg/approval, client-apps/cli/internal/cli/cliprint

## Project Context

### Dependencies
Backend gRPC streaming API (AgentExecutionQueryController.Subscribe), PendingApproval proto messages, existing approval submission APIs

### Success Criteria
- 1. Agent executions stream messages in real-time by default (no --follow flag needed). 2. Approval prompts clearly show tool name
- arguments
- and purpose in a visually distinct panel. 3. Tool calls display structured information (name
- args
- result) not just raw content. 4. Progress indication shows what phase the agent is in between updates. 5. The overall experience feels polished and intentional -- like a world-class product
- not generated boilerplate.

### Known Risks & Mitigations
1. gRPC streaming and polling currently conflict when both run -- needs careful redesign. 2. TUI library adoption (e.g., Bubbletea) may require significant refactoring of display layer. 3. Backend proto changes may be needed to provide richer tool call metadata. 4. Non-TTY environments (CI/CD, piped output) must gracefully degrade.

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