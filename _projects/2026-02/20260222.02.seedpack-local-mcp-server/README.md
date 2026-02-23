# Project: 20260222.02.seedpack-local-mcp-server

## Overview
Add a default local MCP server resource to the seedpack that gets bootstrapped and started alongside the Stigmer server when running 'stigmer server'. The MCP server will use STDIO transport and be available by default alongside the existing skill-creator skill and skill-creator-agent.

**Created**: 2026-02-22
**Completed**: 2026-02-23
**Status**: Complete ✅

## Project Information

### Primary Goal
When 'stigmer server' starts, a local MCP server is also automatically started and available, configured via the seedpack bootstrap process.

### Timeline
**Target Completion**: 1-2 days

### Technology Stack
Go (backend server, CLI, seedpack, MCP server)

### Project Type
Feature Development

### Affected Components
seedpack package, bootstrap process, daemon startup, MCP server, CLI server command

## Project Context

### Dependencies
Existing MCP server implementation (mcp-server/pkg/mcpserver/), existing seedpack infrastructure, existing bootstrap mechanism

### Success Criteria
- 1) MCP server resource is defined in seedpack manifest and YAML 2) Bootstrap process applies the MCP server resource on startup 3) Daemon starts MCP server process alongside Stigmer server 4) MCP server is functional and connects to the local Stigmer server via gRPC

### Known Risks & Mitigations
1) Need to decide between daemon subprocess vs in-process approach for MCP server startup 2) Port/transport coordination between MCP server and Stigmer server 3) Graceful shutdown coordination

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
- [x] Core implementation (Phases 1-3)
- [x] Testing and validation
- [x] Documentation finalized
- [x] Post-merge tagging (`mcp-server/v0.1.0`)
- [x] Go module proxy verification
- [x] Project completed

### Phase 4 (Daemon subprocess management)
Intentionally skipped — STDIO transport means MCP clients spawn the server on demand; no daemon-side process management is needed.

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