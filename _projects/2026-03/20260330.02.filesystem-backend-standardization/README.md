# Project: 20260330.02.filesystem-backend-standardization

## Overview
Bring the filesystem/workspace abstraction layer to the same architectural standard as the HITL flow — eliminate inconsistencies between local and Daytona backends, fix broken shell execution in Daytona mode, seal leaky abstractions, and unify tool error handling across all LLM file/execute tools.

**Created**: 2026-03-30
**Status**: Complete ✅

## Project Information

### Primary Goal
Ensure all file operations (read, write, edit, delete, ls, glob, grep, execute) behave identically across local and Daytona backends, with consistent path resolution, error handling, and display humanization — a unified filesystem experience regardless of deployment mode.

### Timeline
**Target Completion**: 1-2 weeks

### Technology Stack
Python (graphton library, agent-runner service), Daytona SDK (deepagents_cli)

### Project Type
Refactoring

### Affected Components
graphton core backends (filesystem.py, daytona.py, platform_mount.py), tool_wrappers.py, agent-runner workspace backends (local.py, daytona.py, __init__.py), setup.py, subagent_transformer.py, handlers/tool_event.py

## Project Context

### Dependencies
Understanding of Daytona SDK (deepagents_cli.integrations.daytona.DaytonaBackend) — third-party with partially unknown API surface

### Success Criteria
- All LLM tools work identically in local and Daytona mode; shell execution runs from correct workspace root; resolve_platform_command fires correctly; no __getattr__ bypass of normalization; consistent error messages across all tools; single platform_mount module; display humanization consistent across all paths

### Known Risks & Mitigations
deepagents_cli DaytonaBackend is third-party with unknown execute_streaming support; WorkspaceNormalizingBackend changes could affect sandbox stability; multiple backend instances may be intentional for isolation — needs research before changing

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
- [x] Initial analysis complete
- [x] Core implementation (T01-T04 all complete)
- [x] Testing and validation
- [x] Documentation finalized
- [x] Project completed

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