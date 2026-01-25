# Project: 20260126.02.mcp-server-api-resource

## Overview
Extract MCP server configuration from AgentSpec into a separate, reusable API resource with multi-scope support (platform, organization, identity_account)

**Created**: 2026-01-26
**Status**: Active 🟢

## Project Information

### Primary Goal
Create McpServer as a first-class API resource that enables reusability across agents, proper FGA authorization, and marketplace discoverability for MCP server configurations

### Timeline
**Target Completion**: Multi-phase implementation across stigmer and stigmer-cloud repos

### Technology Stack
Protobuf, Go, Java, FGA (Fine-Grained Authorization)

### Project Type
Feature Development

### Affected Components
apis/ai/stigmer/agentic (proto definitions), stigmer-cloud/backend/services (handlers), FGA models, AgentSpec migration

## Project Context

### Dependencies
Existing Skill pattern as reference architecture, Current McpServerDefinition in AgentSpec

### Success Criteria
- McpServer resource with full CRUD operations
- FGA model supporting all three scopes
- AgentSpec integration via mcp_server_refs field
- backward-compatible migration path

### Known Risks & Mitigations
Migration complexity from inline to referenced MCP servers, ensuring backward compatibility, coordinating changes across stigmer and stigmer-cloud repos

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