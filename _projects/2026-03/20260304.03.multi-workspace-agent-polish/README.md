# Project: 20260304.03.multi-workspace-agent-polish

## Overview
Fix agent tool confusion (read vs read_file duplication) and adapt smart workspace context features — relevance signaling, runtime .gitignore filtering, and system prompt workspace descriptions — for multi-workspace sessions. Ensure agents operating across multiple --workspace entries have coherent tool sets, correct path resolution, and full workspace awareness.

**Created**: 2026-03-04
**Status**: Active 🟢

## Project Information

### Primary Goal
Eliminate tool name duplication so agents see one tool per operation (read, not read_file), fix relevance signaling to resolve paths across all workspace entries, fix runtime .gitignore to load per-entry filters, and improve multi-workspace system prompts with explicit CWD and path resolution rules.

### Timeline
**Target Completion**: Flexible, no hard deadline

### Technology Stack
Python (Graphton library, agent-runner worker), Go (CLI tool rendering)

### Project Type
Feature Development

### Affected Components
backend/libs/python/graphton (tool_wrappers, prompt_enhancement, filesystem backend), backend/services/agent-runner (execute_graphton, relevance, provisioner, workspace sources), client-apps/cli (toolrender)

## Project Context

### Dependencies
deepagents library (third-party, controls FilesystemMiddleware behavior)

### Success Criteria
- 1. Agent sees exactly one tool per operation (read
- write
- edit — no _file duplicates). 2. Relevance signaling resolves paths across all workspace entries. 3. Runtime .gitignore filtering works per-entry in multi-workspace sessions. 4. Multi-workspace system prompt includes explicit CWD
- path resolution rules
- and clear entry navigation.

### Known Risks & Mitigations
1. deepagents FilesystemMiddleware may re-inject tools at a layer we cannot easily control. 2. Changing tool registration could affect sub-agent tool inheritance. 3. Runtime .gitignore changes need careful testing to avoid breaking single-workspace sessions.

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