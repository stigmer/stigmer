# Project: 20260217.01.stigmer-mcp-server

## Overview
Design and implement an MCP (Model Context Protocol) server for Stigmer that exposes Stigmer resources — agents, skills, workflows — to AI coding assistants and other MCP-compatible clients. Includes architectural decisions on repository placement (mono repo vs standalone) and a phased approach starting with read-oriented resource operations.

**Created**: 2026-02-17
**Status**: Active 🟢

## Project Information

### Primary Goal
Create an MCP server that enables AI tools (Cursor, Claude Desktop, etc.) to discover and interact with Stigmer resources, starting with agents, skills, and workflows, with a clear extension path for projects, executions, and build artifacts.

### Timeline
**Target Completion**: Multi-week, iterative — Phase 1 (core resources + repo decision) in ~1 week, subsequent phases extend incrementally

### Technology Stack
Go or TypeScript (TBD based on repo decision), MCP SDK, gRPC (Stigmer API), Protocol Buffers

### Project Type
Feature Development

### Affected Components
MCP server (new component), Stigmer gRPC API integration, SDK types, CLI integration (later)

## Project Context

### Dependencies
MCP protocol specification (2025-03-26 streamable HTTP spec), existing Stigmer gRPC API and resource definitions in apis/, MCP SDK libraries

### Success Criteria
- MCP server exposes agents/skills/workflows via MCP resources and tools
- Compatible with major MCP clients (Cursor / Claude Desktop / Windsurf)
- Clear repo placement decision documented with rationale
- Phased roadmap for additional resources established

### Known Risks & Mitigations
MCP protocol still evolving — need to track spec changes, Repository placement decision impacts CI/CD and release cycles, Balancing read-only vs read-write operations for safety in agent contexts

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