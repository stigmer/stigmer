# Project: 20260225.02.mcp-tool-discovery

## Overview
Add MCP server tool/resource discovery to Stigmer. CLI uses the Go MCP SDK to connect locally and discover tools/resources, then pushes results to stigmer-server via a new updateDiscoveredCapabilities RPC. Static seedpack for built-in servers.

**Created**: 2026-02-25
**Status**: Active 🟢

## Project Information

### Primary Goal
Enable Stigmer to store and expose the list of tools/resources available on each configured MCP server, so agents can make informed decisions about which MCP servers to use.

### Timeline
**Target Completion**: 2 weeks

### Technology Stack
Protobuf, Go (CLI, stigmer-server, mcp-server codegen), buf generate

### Project Type
Feature Development

### Affected Components
APIs (proto definitions), stigmer-server (RPC handler, seedpack), CLI (discover command), mcp-server (codegen)

## Project Context

### Dependencies
Go MCP SDK (github.com/modelcontextprotocol/go-sdk v1.3.0) - already a dependency in cli/go.mod

### Success Criteria
- stigmer discover mcp-server <name> connects to an MCP server
- discovers tools/resources
- stores them in McpServer.status.discovered_capabilities
- and the seedpack stigmer-mcp-server has its 12 tools and 5 resources pre-populated

### Known Risks & Mitigations
Go MCP SDK client API edge cases with different transports (stdio vs HTTP); buf codegen compatibility across repos

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