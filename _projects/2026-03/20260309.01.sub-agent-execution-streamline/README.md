# Project: 20260309.01.sub-agent-execution-streamline

## Overview
Streamline sub-agent execution modeling, agent-runner capture, and CLI rendering. Close gaps identified in proto contracts, Python status_builder event routing, and Go CLI display to deliver a correct, complete, and Cursor-quality sub-agent UX.

**Created**: 2026-03-09
**Status**: Active 🟢

## Project Information

### Primary Goal
Fix all identified gaps across proto model, agent-runner (Python), and CLI (Go) layers so that sub-agent executions are properly modeled, captured, and rendered — including output display, approval context, namespace routing, and collapsed/expanded views.

### Timeline
**Target Completion**: 1 week

### Technology Stack
Protobuf, Python (LangGraph agent-runner / status_builder), Go (CLI / Bubbletea TUI)

### Project Type
Refactoring

### Affected Components
apis/ai/stigmer/agentic/agentexecution/v1/ (protos), backend/services/agent-runner/worker/activities/graphton/ (Python status_builder), client-apps/cli/cmd/stigmer/root/ (Go CLI renderer), client-apps/cli/pkg/executiontui/ (Go event types), client-apps/cli/pkg/toolrender/ (Go tool rendering)

## Project Context

### Dependencies
DeepAgents library (provides the task tool and sub-agent graph execution)

### Success Criteria
- 1. Sub-agent output is visible in CLI (collapsed and expanded). 2. Approval prompts show sub-agent context. 3. No subject LLM generation — use description from task tool args directly. 4. Task tool call is not shown separately in CLI — sub-agent block is the sole representation. 5. SubAgentExecution proto has parent_tool_call_id
- description
- pending_approvals. 6. Namespace routing handles concurrent sub-agents without misrouting. 7. Sub-agent cancellation propagates from parent.

### Known Risks & Mitigations
1. Namespace heuristic routing for concurrent sub-agents is fundamentally fragile — may need LangGraph-level changes. 2. Removing subject generation changes the streaming UX (no instant label until backend populates description). 3. Proto field additions require coordinated backend+CLI deployment.

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