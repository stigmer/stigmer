# Project: 20260127.04.mcp-server-lifecycle-management

## Overview
Implement runtime lifecycle management for MCP servers (stdio subprocesses, HTTP clients, Docker containers) within the agent runner execution environment

**Created**: 2026-01-27
**Status**: Active 🟢

## Project Information

### Primary Goal
Enable agent runner to start, monitor, and gracefully shutdown MCP servers of all three types (stdio/http/docker) with proper resource management, error handling, and cleanup

### Timeline
**Target Completion**: 2-3 weeks

### Technology Stack
Python (agent runner), Docker SDK, subprocess management, asyncio

### Project Type
Feature Development

### Affected Components
stigmer-cloud/backend agent runner, MCP server orchestration layer

## Project Context

### Dependencies
MCP Server API Resource project (Phase 1-4 complete), Environment Variables project (env resolution), Docker runtime availability

### Success Criteria
- Stdio servers start as subprocesses with proper stdin/stdout pipes; HTTP servers configured with connection pooling and retry logic; Docker containers start with volume mounts and port mappings; All server types shutdown gracefully on agent completion; Health monitoring and auto-recovery for failed servers; Resource cleanup (no orphaned processes or containers)

### Known Risks & Mitigations
Docker availability on execution nodes, Process management complexity (zombie processes, signal handling), Network port conflicts for Docker containers, Volume mount permissions and security, Cross-platform compatibility (Linux/macOS/Windows)

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