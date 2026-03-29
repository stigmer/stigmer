# Project: 20260329.01.hitl-tool-call-separation

## Overview
Extract tool calls from the AgentExecution document into a separate MongoDB collection where each tool call is its own document. Add a dedicated RPC for tool call updates. This eliminates full-replace race conditions on concurrent approvals and reduces AgentExecution document size.

**Created**: 2026-03-29
**Status**: Active 🟢

## Project Information

### Primary Goal
Separate tool calls into their own collection with individual document-level atomicity, replace full-replace update pattern with per-tool-call RPCs, and simplify the HITL approval flow so approval decisions are DB-driven rather than signal-counted.

### Timeline
**Target Completion**: No rush, get it right

### Technology Stack
Go, Java, Python, Protobuf, MongoDB, Temporal, LangGraph

### Project Type
Refactoring

### Affected Components
stigmer-server (Go), stigmer-service (Java), agent-runner (Python/StatusBuilder), proto definitions, frontend read path

## Project Context

### Dependencies
None identified

### Success Criteria
- Tool calls stored in separate collection
- No full-replace races on concurrent approvals
- SubmitApproval checks DB for all-approved then signals once
- StatusBuilder uses new RPC for tool updates
- Frontend API unchanged (server-side join)
- Both Go and Java control planes updated

### Known Risks & Mitigations
New collection pattern breaks single-document-per-resource convention, Migration of existing executions with embedded tool calls, Read path performance (server-side join), Consistency between execution doc and tool call docs, Large scope touching Go Java and Python across two repos

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