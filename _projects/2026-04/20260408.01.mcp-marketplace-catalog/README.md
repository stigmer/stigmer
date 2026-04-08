# Project: 20260408.01.mcp-marketplace-catalog

## Overview
Populate the Stigmer MCP marketplace with well-crafted McpServer resource definitions for popular public MCP servers. Each definition includes proper env_spec, default_tool_approvals, tags, icons, and discovered_capabilities — giving platform builders immediate utility out of the box.

**Created**: 2026-04-08
**Status**: Active 🟢

## Project Information

### Primary Goal
Create 15-20 high-quality McpServer YAML definitions for the most popular MCP servers (GitHub, PostgreSQL, Slack, Filesystem, Brave Search, etc.), decide where the catalog lives, and establish the workflow for adding new servers.

### Timeline
**Target Completion**: Flexible / no hard deadline

### Technology Stack
Protobuf/YAML (McpServer resource definitions), Go (CLI discovery tooling), MCP Registry REST API

### Project Type
Feature Development

### Affected Components
seedpack/ (existing MCP server definitions), apis/ai/stigmer/agentic/mcpserver/ (proto definitions), client-apps/cli/ (discovery commands)

## Project Context

### Dependencies
Official MCP Registry API at registry.modelcontextprotocol.io for importing server metadata

### Success Criteria
- 15-20 McpServer YAMLs with complete env_spec and tool approvals
- catalog location decided and documented
- discovery run on each server
- clear process for adding new servers

### Known Risks & Mitigations
MCP Registry API is in preview and may change. Some MCP servers may require runtime dependencies (Node.js/Python) that need documenting. Server tool sets may change across versions requiring re-discovery.

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