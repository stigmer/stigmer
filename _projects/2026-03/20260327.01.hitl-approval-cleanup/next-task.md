# Next Task: 20260327.01.hitl-approval-cleanup

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260327.01.hitl-approval-cleanup

**Description**: Eliminate the root-level tool_calls duplication and the Python-managed pending_approvals shadow state. Tool calls live in messages only. Pending approvals become a server-side computed projection. Interrupt matching uses tool_call_id from the LangGraph checkpoint directly, eliminating all fuzzy matching.
**Goal**: Simplify the HITL approval flow to have two sources of truth (messages for tool calls, LangGraph checkpoint for interrupts) instead of six, eliminating the class of sync bugs that caused four cascading HITL fixes in a single day.
**Tech Stack**: Protobuf, Python/LangGraph, Java/Spring, Go, TypeScript/React
**Components**: Proto APIs (approval.proto, api.proto, message.proto, subagent.proto), Python agent-runner (status_builder, hitl, streaming, execute_graphton), Graphton core (tool_wrappers, interrupt_proxy), Java stigmer-service (UpdateStatusHandler, SubmitApprovalHandler, PendingApprovalMerger, InvokeAgentExecutionWorkflowImpl), Go stigmer-server (update_status, submit_approval, approval/merge), Go workflow-runner (task builders), React SDK (useSessionConversation), CLI (run_stream_snapshot, run_display_summary)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Task Map

| Task | Title | Status | Depends on |
|------|-------|--------|------------|
| **T01** | Research: tool_call_id availability at interrupt time | **COMPLETE** | — |
| T02 | Proto changes (remove tool_calls, simplify PendingApproval) | Not started | — |
| T03 | Python: single writer to messages, simplify HITL | Not started | T01, T02 |
| **T04** | Add tool_call_id to interrupt payload | **COMPLETE** | T01 |
| T05 | Java/Go: compute pending_approvals on write, simplify SubmitApproval | Not started | T02, T03 |
| T06 | React SDK: remove polling/staleness workarounds | Not started | T05 |
| T07 | Tests: rewrite for new architecture | Not started | T03, T04, T05 |

## Current Status

**Created**: 2026-03-27
**Current Task**: T01 + T04 COMPLETE. Next: T02 (unblocked, proto changes).
**Status**: T04 Complete — `InjectedToolCallId` injection across all tool wrappers, minimal interrupt payload `{tool_call_id, message}`, fuzzy matching chain removed from InterruptCapture, all tests green (graphton 1209 passed, agent-runner 1351 passed)

## Session Progress (2026-03-27, Session 2)

### Accomplished
- Completed T04: Add `tool_call_id` to interrupt payload — full implementation across production code and tests
- Implemented `InjectedToolCallId` injection in all 6 tool wrapper call sites
- Simplified `_check_and_handle_approval` from 7 params to 4; interrupt payload from 8 fields to 2
- Eliminated fuzzy matching chain in `InterruptCapture` — direct `tool_call_id` lookup
- Discovered and fixed `args_schema` copy + `InjectedToolCallId` conflict with merged schema approach
- All tests passing: graphton (1209), agent-runner (1351)

### Key Decisions
- **DD-002** (from Session 1): Interrupt payload `{tool_call_id, message}` — confirmed and implemented
- **Merged schema for MCP wrappers**: `_build_merged_schema()` creates Pydantic model with both MCP tool params (LLM-visible) and `InjectedToolCallId` (runtime-injected)
- **Args unwrapping refactored**: `_approval_tool_kwargs_to_actual_args()` strips injected keys before unwrapping `kwargs`/`input` shells

### Surprise Found
- `args_schema` copy on approval wrapper destroys `InjectedToolCallId` metadata — not anticipated in T01 research. Fixed with `_build_merged_schema()`.

## Next Steps
1. **T02** (Proto changes): Remove `tool_calls` from `AgentExecutionStatus` and `SubAgentExecution`, simplify `PendingApproval`, delete `ApprovalLifecycleState` — this is the recommended next task
2. T03 becomes unblocked after T02; T07 partially unblocked by T04 completion

## Quick Commands

After loading context:
- "Pick next task" - T02 is the recommended next
- "Show project status" - Get overview of progress
- "Review design decisions" - Check DD-001 and DD-002

---

*This file provides direct paths to all project resources for quick context loading.*
