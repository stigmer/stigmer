# Project: 20260130.05.subagent-execution-support

## Overview
Implement subagent support in execute_graphton.py to wire up proto SubAgent definitions from AgentSpec to graphton's create_deep_agent function. The proto API is fully designed (SubAgent, McpAccess), the graphton library supports subagents, and StatusBuilder already tracks SubAgentExecution - only the orchestration layer in execute_graphton.py needs to be built.

**Created**: 2026-01-30
**Status**: Active 🟢

## Project Information

### Primary Goal
Enable agents to delegate work to specialized subagents as defined in AgentSpec.sub_agents, with proper MCP access restriction, skill resolution, and permission validation.

### Timeline
**Target Completion**: No specific timeline - incremental work

### Technology Stack
Python (LangGraph/Graphton), Protocol Buffers, gRPC

### Project Type
Feature Development

### Affected Components
backend/services/agent-runner/worker/activities/execute_graphton.py, potentially new transformation utilities

## Project Context

### Dependencies
Depends on existing proto SubAgent definitions in agent/v1/spec.proto, graphton create_deep_agent subagents parameter, and StatusBuilder sub-agent tracking (Phase 2.3)

### Success Criteria
- 1) AgentSpec.sub_agents are transformed and passed to create_deep_agent
- 2) SubAgent MCP access restrictions are enforced
- 3) SubAgent skills are resolved and injected
- 4) SubAgentExecution tracking works end-to-end

### Known Risks & Mitigations
1) Permission model complexity (ensuring subagent can only access parent's MCP servers), 2) Recursive skill resolution for each subagent, 3) Testing complexity without real subagent scenarios

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