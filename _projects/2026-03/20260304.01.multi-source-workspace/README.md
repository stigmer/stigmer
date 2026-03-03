# Project: 20260304.01.multi-source-workspace

## Overview
Enable sessions to support multiple workspace sources (local paths and git repos) treated as a single unified workspace, mirroring VS Code's multi-root workspace model.

**Created**: 2026-03-04
**Status**: Active 🟢

## Project Information

### Primary Goal
Allow users to pass multiple --workspace flags to stigmer run, so an agent can operate across multiple directories/repos in a single session.

### Timeline
**Target Completion**: 1-2 weeks, phased MVP delivery

### Technology Stack
Protobuf (buf), Go (CLI), Python (agent-runner backend)

### Project Type
Feature Development

### Affected Components
Proto APIs (session/v1), CLI (client-apps/cli), Backend provisioner (agent-runner), Workspace backend, System prompt generation

## Project Context

### Dependencies
None — no backward compatibility required, clean break from singular workspace_source

### Success Criteria
- 1. stigmer run agent my-agent --workspace ./repo-a --workspace ./repo-b provisions both directories as a unified workspace. 2. System prompt describes all workspace entries. 3. Multiple git repos clone into named subdirectories in cloud mode. 4. Workspace file refs work across multiple local roots.

### Known Risks & Mitigations
1. WorkspaceBackend single-root_dir assumption is deeply embedded. 2. Git clone idempotency logic assumes .git at workspace root. 3. File tree generation and git diff artifacts are single-source.

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