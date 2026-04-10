# Project: 20260410.01.curated-mcp-marketplace

## Overview
Replace the automated MCP Registry sync (temporal workflow) with a hand-curated set of ~33 high-quality MCP server definitions in the seedpack, organized by use-case category. Remove temporal workflow, clean up McpServerSource proto, and create curated YAML files.

**Created**: 2026-04-10
**Status**: Active 🟢

## Project Information

### Primary Goal
Transition from automated bulk-synced MCP servers to a curated, trustworthy marketplace with ~33 hand-picked servers across 11 categories (developer tools, databases, search, cloud, communication, productivity, web automation, monitoring, payments, design, marketing).

### Timeline
**Target Completion**: 1 week

### Technology Stack
Protocol Buffers, YAML, Java/Spring (stigmer-cloud), Go (stigmer CLI)

### Project Type
Refactoring

### Affected Components
stigmer/seedpack/mcp-servers, stigmer/apis/ai/stigmer/agentic/mcpserver/v1/spec.proto, stigmer-cloud/backend temporal workflow, stigmer CLI (for deletion)

## Project Context

### Dependencies
Need stigmer CLI connected to the running environment for deleting synced MCP servers. BuildMcpSnapshot workflow must be preserved when removing sync workflow.

### Success Criteria
- All synced MCP servers deleted from DB
- temporal sync workflow removed from stigmer-cloud
- McpServerSource proto slimmed to repository_url + github_stars only
- ~33 curated YAML files created in seedpack/mcp-servers/
- seedpack apply bootstraps all curated servers successfully

### Known Risks & Mitigations
BuildMcpSnapshot workflow shares directory with sync workflow - must preserve it carefully. Some community MCP server GitHub repos may have changed or been archived. LinkedIn MCP servers are community-maintained (not official).

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
- [x] Task 1: Cleanup -- sync workflow removed, PR #114
- [x] Task 2: Proto cleanup + seedpack preparation
- [ ] Task 3: Curated YAML creation
- [ ] Testing and validation
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