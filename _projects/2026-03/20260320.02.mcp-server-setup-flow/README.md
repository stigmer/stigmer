# Project: 20260320.02.mcp-server-setup-flow

## Overview
Add proactive secret collection, live tool discovery, and per-tool selection for MCP servers in the SessionComposer — mirroring the agent setup flow but adapted for multi-select.

**Created**: 2026-03-20
**Status**: Active 🟢

## Project Information

### Primary Goal
When a user selects MCP servers in SessionComposer, proactively check env_spec, collect credentials via inline form, trigger on-demand tool discovery, display discovered tools for selection, and build McpServerUsageInput with enabledTools. Extract shared EnvVarForm from AgentEnvForm for reuse.

### Timeline
**Target Completion**: 1 week

### Technology Stack
TypeScript/React (SDK hooks and components in @stigmer/react), Go (backend on-demand discovery endpoint)

### Project Type
Feature Development

### Affected Components
@stigmer/react (McpServerPicker, McpServerConfigPanel, McpToolSelector, useMcpServerSetup, SessionComposer), backend McpServer service (discovery RPC), @stigmer/react shared EnvVarForm extraction

## Project Context

### Dependencies
secrets-flow-hardening project (T05+T06 pending commit), agent-picker-personal-env project (useAgentSetup, AgentEnvForm, diffEnvSpec)

### Success Criteria
- 1) MCP server selection in SessionComposer proactively checks env_spec and collects missing credentials. 2) Live tool discovery triggered after credential collection. 3) Per-tool selection UI with discovered tools. 4) EnvVarForm extracted from AgentEnvForm and shared. 5) Send button blocked when MCP servers need configuration. 6) All new hooks/components in @stigmer/react with zero Console dependencies.

### Known Risks & Mitigations
Backend discovery endpoint needs to be built (new RPC). Multi-select UX complexity for per-server configuration. Tool discovery latency may affect UX. Chicken-and-egg: tools need credentials to discover, but tool selection comes after credential collection.

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