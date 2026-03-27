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
| **T02** | Proto changes (remove tool_calls, simplify PendingApproval) | **COMPLETE** | — |
| T03 | Python: single writer to messages, simplify HITL | Not started | T01, T02 |
| **T04** | Add tool_call_id to interrupt payload | **COMPLETE** | T01 |
| T05 | Java/Go: compute pending_approvals on write, simplify SubmitApproval | Not started | T02, T03 |
| T06 | React SDK: remove polling/staleness workarounds | Not started | T05 |
| T07 | Tests: rewrite for new architecture | Not started | T03, T04, T05 |

## Current Status

**Created**: 2026-03-27
**Current Task**: T01 + T04 + T02 COMPLETE. Next: T03 (unblocked, Python single-writer).
**Status**: T02 Complete — Proto data model cleaned up. Flat `tool_calls` removed from `AgentExecutionStatus` and `SubAgentExecution`. `ApprovalLifecycleState` enum deleted. `PendingApproval` simplified to UI-facing projection (fields 9-12 removed). `args_preview` added to `ToolCall`. Stubs regenerated in both stigmer and stigmer-cloud. All committed on `hitl-flow-simplification` branch.

## Session Progress (2026-03-27, Session 3)

### Accomplished
- Completed T02: Proto data model cleanup — all 4 proto files edited, stubs regenerated in both repos
- Deleted `ApprovalLifecycleState` enum entirely (5 values, ~50 lines)
- Removed `interrupt_id`, `lifecycle_state`, `decision_action`, `decision_recorded_at` from `PendingApproval`
- Removed flat `tool_calls` from `AgentExecutionStatus` (field 3) and `SubAgentExecution` (field 10)
- Removed `pending_approvals` from `SubAgentExecution` (field 14) — root-level computed projection with `from_sub_agent`/`sub_agent_name` preserves provenance
- Added `args_preview` (field 18) to `ToolCall` for computed projection sourcing
- Rewrote `PendingApproval` and `pending_approvals` documentation for computed-projection semantics
- Removed unused imports (`enum.proto` from approval.proto, `approval.proto` from subagent.proto)
- `make protos` passed cleanly in both stigmer and stigmer-cloud (buf lint, all language stubs)
- Committed all work on `hitl-flow-simplification` branch in both repos
- Net deletion: ~2,655 lines across both repos

### Key Decisions
- No `reserved` field declarations — no backward compatibility needed (pre-GA)
- Sub-agent approval provenance preserved via `PendingApproval.from_sub_agent` + `sub_agent_name` on the root-level list — no information lost

### Surprises
- None. T02 was a clean proto-only task with predictable scope.

## Next Steps
1. **T03** (Python: single writer to messages, simplify HITL): Now unblocked by T01+T02. Make `messages[].tool_calls` the single write target. Remove flat list writes from `StatusBuilder`. Simplify `hitl.py` — delete `ApprovalStateManager`, simplify `InterruptCapture` further, rewrite `ResumeReconciler`.
2. T05 (Java/Go) becomes unblocked after T03
3. T07 partially unblocked by T04 completion (Python tests already rewritten)

## Quick Commands

After loading context:
- "Pick next task" — T03 is the recommended next
- "Show project status" — Get overview of progress
- "Review design decisions" — Check DD-001 and DD-002

---

*This file provides direct paths to all project resources for quick context loading.*
