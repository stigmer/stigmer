# Project: 20260207.04.execution-lifecycle-control

## Overview
Add user-facing retry, cancel, and resume capabilities for workflow and agent executions to fulfill the 'durable workflows' promise

**Created**: 2026-02-07
**Status**: Active 🟢

## Project Information

### Primary Goal
Enable users to cancel running executions, retry failed executions, and resume from checkpoints - completing the durability story for agentic workflows

### Timeline
**Target Completion**: 2-3 weeks

### Technology Stack
Go/gRPC, Protobuf, Temporal, CLI (Cobra)

### Project Type
Feature Development

### Affected Components
apis/workflowexecution, apis/agentexecution, backend handlers, CLI commands, Temporal integration

## Project Context

### Dependencies
Existing WorkflowRunner internal interface (cancel/pause/resume), Temporal workflow primitives

### Success Criteria
- 1. Users can cancel running executions via API/CLI 2. Users can retry failed executions via API/CLI 3. EXECUTION_PAUSED phase exists and works 4. CLI has cancel/retry subcommands for agent/workflow 5. Retry preserves original spec but creates new execution ID

### Known Risks & Mitigations
1. Temporal integration complexity for partial retry 2. Race conditions between cancel and status updates 3. Retry from specific task may require workflow definition changes

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

## Key Research Findings

### The Problem

The landing page positions Stigmer as **"Open-source Durable Agentic Workflows"** with messaging like:
- "Durable execution: Workflows keep state and resume after failures"
- "Chain specialists, branch, retry, and resume"
- "Workflows that don't lose state"

However, the **current user-facing APIs don't support these claims**:

| Capability | Current State |
|------------|---------------|
| Cancel running execution | ❌ Internal only (`WorkflowRunner.cancelExecution`) |
| Retry failed execution | ❌ Manual workaround (copy spec, create new execution) |
| Pause execution | ❌ Internal only + no `EXECUTION_PAUSED` phase |
| Resume execution | ❌ Internal only |

### What Exists

The internal `WorkflowRunnerServiceController` interface has:
- `cancelExecution`, `pauseExecution`, `resumeExecution`

But these are **service-to-service calls** not exposed to users.

The user-facing `WorkflowExecutionCommandController` only has:
- `create`, `update`, `updateStatus`, `submitApproval`, `delete`

### The Solution

This project adds user-facing lifecycle control:
1. **cancel** - Cancel a running execution (API + CLI)
2. **retry** - Retry a failed execution with same inputs (API + CLI)
3. **pause/resume** - Pause and resume executions (API + CLI)

See [tasks/T01_0_plan.md](tasks/T01_0_plan.md) for detailed implementation plan.

## Notes

_Add any additional notes, links, or context here as the project evolves._