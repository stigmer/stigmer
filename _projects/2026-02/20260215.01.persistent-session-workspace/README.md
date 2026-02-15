# Project: 20260215.01.persistent-session-workspace

## Overview
Implement session-scoped persistent workspace using Daytona volumes and local session directories, ensuring agent execution resumes seamlessly after approval regardless of sandbox lifecycle.

**Created**: 2026-02-15
**Status**: Active 🟢

## Project Information

### Primary Goal
Make post-approval execution resumption correct by construction — workspace files persist via Daytona volumes (cloud) and session-scoped directories (local), independent of sandbox lifecycle.

### Timeline
**Target Completion**: 1-2 weeks

### Technology Stack
Python, Daytona SDK, Protocol Buffers, Go (Temporal workflow)

### Project Type
Feature Development

### Affected Components
agent-runner service (sandbox_manager, execute_graphton, config), graphton library (backends, sandbox_factory), session proto, Temporal workflow

## Project Context

### Dependencies
Daytona SDK >=0.113.0 with Volume API support (confirmed available)

### Success Criteria
- Agent resumes after approval with all workspace files intact regardless of sandbox state
- Local mode uses session-scoped directories
- Daytona mode uses persistent volumes with session subpaths
- Sandbox auto-delete disabled to preserve runtime installations

### Known Risks & Mitigations
Daytona volume FUSE performance for high-frequency file operations, 100 volume per org limit (mitigated by one-volume-per-org design), SDK version compatibility for Volume API

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