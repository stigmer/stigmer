# Project: 20260225.03.agent-instance-ref-migration

## Overview
Replace opaque agent_instance_id strings with ApiResourceReference (org + kind + slug) across SessionSpec and AgentStatus, making the system human-readable and consistent with existing codebase patterns like environment_refs.

**Created**: 2026-02-25
**Status**: Active 🟢

## Project Information

### Primary Goal
Eliminate opaque system-generated IDs from user-facing surfaces by replacing them with human-readable ApiResourceReference throughout the session and agent execution flows.

### Timeline
**Target Completion**: 2-3 days

### Technology Stack
Protobuf, Go, Python, gRPC

### Project Type
Refactoring

### Affected Components
Proto APIs (session/v1, agent/v1), Go backend (stigmer-server agent execution, session controller), Python agent-runner (execute_graphton), CLI (session display)

## Project Context

### Dependencies
None - all infrastructure (ApiResourceReference, getByReference RPC) already exists in the codebase

### Success Criteria
- SessionSpec uses ApiResourceReference instead of string ID; AgentStatus default_instance_id removed (convention-based slug); CLI shows human-readable org/slug; ListSessionsByAgentRequest uses reference instead of ambiguous agent_id

### Known Risks & Mitigations
ListSessionsByAgentRequest has existing naming confusion (agent_id used as agent_instance_id); Python agent-runner generated stubs need careful verification after buf generate

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