# Project: 20260226.02.agent-runner-mcp-resources

## Overview
Add MCP resources and resource templates support to the Stigmer agent runner, enabling agents to discover and read MCP resources (not just tools). This is needed for mcp-server-planton's cloud resource schema discovery via resource templates.

**Created**: 2026-02-26
**Status**: Active 🟢

## Project Information

### Primary Goal
Enable the LangGraph-based agent runner to list and read MCP resources from connected MCP servers, so agents can auto-discover typed schemas (e.g., cloud resource provider specs) exposed as MCP resource templates.

### Timeline
**Target Completion**: 1-2 weeks

### Technology Stack
Python, LangGraph, langchain-mcp-adapters, MCP SDK

### Project Type
Feature Development

### Affected Components
backend/services/agent-runner, backend/libs/python/graphton

## Project Context

### Dependencies
langchain-mcp-adapters library (need to verify if it supports MCP resources natively or if custom implementation is needed)

### Success Criteria
- Agent runner can list MCP resources from connected servers
- read specific resources by URI
- and use resource templates with parameters. Agents automatically discover and use relevant resources during execution.

### Known Risks & Mitigations
langchain-mcp-adapters may not support MCP resources natively requiring custom MCP client integration. Resource discovery adds latency to agent startup. Large number of resources from some servers may need filtering/pagination.

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