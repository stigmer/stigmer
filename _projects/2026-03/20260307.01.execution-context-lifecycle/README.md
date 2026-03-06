# Project: 20260307.01.execution-context-lifecycle

## Overview
Implement proper ExecutionContext lifecycle for agent execution: create ExecutionContext with fully-merged environment during execution creation, pass only a slim input (no secrets) to the Temporal workflow, and clean up the ExecutionContext when execution completes.

**Created**: 2026-03-07
**Status**: Active 🟢

## Project Information

### Primary Goal
Remove secrets from Temporal workflow history, introduce server-side ExecutionContext creation with full environment merging (agent defaults + environment_refs + runtime_env), strip runtime_env from persisted AgentExecution, and add ExecutionContext cleanup on workflow completion.

### Timeline
**Target Completion**: 3-5 days

### Technology Stack
Go/Temporal/gRPC/Protocol Buffers/Python

### Project Type
Feature Development

### Affected Components
backend/services/stigmer-server (create pipeline, Temporal workflow, activities, downstream clients), backend/services/agent-runner (already supports ExecutionContext - no changes needed)

## Project Context

### Dependencies
ExecutionContext controller already fully implemented (create, delete, getByExecutionId). Agent-runner already has ExecutionContext client with try_get_by_execution_id fallback.

### Success Criteria
- 1. Temporal workflow history contains no secrets (slim input only). 2. ExecutionContext is created with fully-merged env during agent execution creation. 3. runtime_env is stripped from persisted AgentExecution after ExecutionContext creation. 4. ExecutionContext is deleted when workflow completes (success or failure). 5. Agent-runner uses ExecutionContext instead of legacy merge.

### Known Risks & Mitigations
Breaking change: Temporal workflow input type changes from full AgentExecution proto to slim struct - in-flight workflows will fail on replay. Mitigation: drain running workflows before deployment.

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
- [x] T01: Downstream clients (Environment query, ExecutionContext command)
- [ ] T02: CreateExecutionContextStep (pipeline step + server wiring)
- [ ] T03: Slim workflow input (remove secrets from Temporal history)
- [ ] T04: Cleanup activity (delete ExecutionContext on completion)
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