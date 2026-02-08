# Project: 20260208.01.durable-agentic-workflows

## Overview
Make Stigmer a fully durable agentic workflow platform with all 5 durability layers - workflow-level, agent-level, tool-level, ingress-level, and ops-level guarantees

**Created**: 2026-02-08
**Status**: Active 🟢

## Project Information

### Primary Goal
Implement the complete durability stack so agent tasks resume after crashes and long pauses, tool side effects are protected via idempotency, and events are delivered race-free

### Timeline
**Target Completion**: Q1 2026 - Complete by end of March

### Technology Stack
Go, Python, TypeScript, Temporal, LangGraph

### Project Type
Feature Development

### Affected Components
Agent executor, workflow engine, tool execution layer, event ingress, worker deployment

## Project Context

### Dependencies
Existing Temporal infrastructure, LangGraph integration, Continue-as-new and Claim Check implementations

### Success Criteria
- Agent tasks resume after crashes and long pauses without losing progress
- Tool side effects protected from retries via idempotency
- Race-proof deduped event delivery via Signal-With-Start
- User-facing lifecycle APIs (pause/resume/cancel)

### Known Risks & Mitigations
Rising competitive pressure from Restate/Trigger.dev/Inngest/DBOS/Hatchet, Complexity of Temporal-LangGraph boundary implementation, History growth management for fine-grained agent events

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