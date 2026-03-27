# Project: 20260327.01.hitl-approval-cleanup

## Overview
Eliminate the root-level tool_calls duplication and the Python-managed pending_approvals shadow state. Tool calls live in messages only. Pending approvals become a server-side computed projection. Interrupt matching uses tool_call_id from the LangGraph checkpoint directly, eliminating all fuzzy matching.

**Created**: 2026-03-27
**Status**: Active 🟢

## Project Information

### Primary Goal
Simplify the HITL approval flow to have two sources of truth (messages for tool calls, LangGraph checkpoint for interrupts) instead of six, eliminating the class of sync bugs that caused four cascading HITL fixes in a single day.

### Timeline
**Target Completion**: 2-3 weeks

### Technology Stack
Protobuf, Python/LangGraph, Java/Spring, Go, TypeScript/React

### Project Type
Refactoring

### Affected Components
Proto APIs (approval.proto, api.proto, message.proto, subagent.proto), Python agent-runner (status_builder, hitl, streaming, execute_graphton), Graphton core (tool_wrappers, interrupt_proxy), Java stigmer-service (UpdateStatusHandler, SubmitApprovalHandler, PendingApprovalMerger, InvokeAgentExecutionWorkflowImpl), Go stigmer-server (update_status, submit_approval, approval/merge), Go workflow-runner (task builders), React SDK (useSessionConversation), CLI (run_stream_snapshot, run_display_summary)

## Project Context

### Dependencies
LangGraph interrupt API must support carrying tool_call_id in the interrupt value payload (we control the Graphton wrapper so this is under our control)

### Success Criteria
- Single source of truth for tool calls (messages only)
- pending_approvals computed server-side in Java/Go only
- no Python pending_approvals management
- interrupt matching via tool_call_id (no fuzzy matching)
- ApprovalLifecycleState enum deleted
- PendingApprovalMerger deleted
- InterruptCapture/ApprovalStateManager/CheckpointFallback classes deleted
- all HITL contract tests rewritten for new architecture

### Known Risks & Mitigations
tool_call_id may not be natively available at interrupt time in LangChain tool execution context (mitigated: we control Graphton and can thread it), streaming tool call timing requires investigation (tool calls detected before parent AI message finalized), MongoDB queries filtering on status.tool_calls need migration, proto field removal is a breaking change for CLI (accepted: CLI revamp planned separately)

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