# Next Task: 20260327.01.hitl-approval-cleanup

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260327.01.hitl-approval-cleanup

**Description**: Eliminate the root-level tool_calls duplication and the Python-managed pending_approvals shadow state. Tool calls live in messages only. Pending approvals become a server-side computed projection. Interrupt matching uses tool_call_id from the LangGraph checkpoint directly, eliminating all fuzzy matching.
**Goal**: Simplify the HITL approval flow to have two sources of truth (messages for tool calls, LangGraph checkpoint for interrupts) instead of six, eliminating the class of sync bugs that caused four cascading HITL fixes in a single day.
**Tech Stack**: Protobuf, Python/LangGraph, Java/Spring, Go, TypeScript/React
**Components**: Proto APIs (approval.proto, api.proto, message.proto, subagent.proto), Python agent-runner (status_builder, hitl, streaming, execute_graphton), Graphton core (tool_wrappers, interrupt_proxy), Java stigmer-service (UpdateStatusHandler, SubmitApprovalHandler, PendingApprovalComputer, InvokeAgentExecutionWorkflowImpl), Go stigmer-server (update_status, submit_approval, approval/compute), Go workflow-runner (task builders), React SDK (useSessionConversation), CLI (run_stream_snapshot, run_display_summary)

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
| **T03** | Python: single writer to messages, simplify HITL | **COMPLETE** | T01, T02 |
| **T04** | Add tool_call_id to interrupt payload | **COMPLETE** | T01 |
| **T05** | Java/Go: compute pending_approvals on write, simplify SubmitApproval | **COMPLETE** | T02, T03 |
| T06 | React SDK: remove polling/staleness workarounds | Not started | T05 |
| T07 | Tests: rewrite for new architecture | Not started | T03, T04, T05 |

## Current Status

**Created**: 2026-03-27
**Current Task**: T01–T05 COMPLETE. Next: T06 (React SDK) or T07 (comprehensive tests).
**Status**: T05 Complete — Go and Java server-side fully refactored across both repos (stigmer + stigmer-cloud). `pending_approvals` is now a server-computed projection from `messages[].tool_calls`. Old `PendingApprovalMerger` deleted in both languages. `WorkflowPendingApproval` wrapper introduced for clean domain separation. Full-replace protocol for workflow-level pending_approvals. Both repos compile and Go tests pass.

## Session Progress (2026-03-27, Session 5)

### Accomplished
- Completed T05: Go/Java server-side compute pending_approvals — all 10 phases
- Proto modeling fix: `WorkflowPendingApproval` wrapper, `child_agent_execution_id` moved from `PendingApproval`
- Go: Created `ComputePendingApprovals`, rewrote 7 source files, updated CLI (7 files), updated tests (3 files)
- Java: Created `PendingApprovalComputer`, deleted `PendingApprovalMerger`, rewrote 8 source files, updated 4 test files
- Net: ~2011 insertions, ~3924 deletions across both repos (95 files total)

### Key Decisions
- Added `loadExecution()` to Java `UpdateExecutionStatusActivity` (Go already had `LoadAgentExecutionActivity`)
- Full-replace protocol for workflow pending_approvals — no merge, just replace
- HITL workflow loop loads execution from DB for pending_approvals count (Python's slim return no longer includes them)

## Next Steps
1. **T06** (React SDK): Remove polling/staleness workarounds — possible now that server-computed `pending_approvals` are reliable
2. **T07** (Tests): Java integration tests, comprehensive end-to-end validation
3. Create PRs for both repos on `hitl-flow-simplification` branch

## Context for Resume
- All changes are on the `hitl-flow-simplification` branch in both repos
- Go and Java both compile clean; Go tests pass
- Java tests compile in Bazel but are not runnable in Bazel (use Spring Boot test runner)
- The `PendingApprovalComputer` pattern is identical in both languages: scan messages + sub-agent messages for tool calls matching the 3-way filter
- `WorkflowPendingApproval` wraps `PendingApproval` with `child_agent_execution_id` for workflow-level routing

## Quick Commands

After loading context:
- "Pick next task" — T06 (React SDK) or T07 (Tests)
- "Show project status" — Get overview of progress
- "Review design decisions" — Check DD-001 and DD-002
- "Create PRs" — Ready for review on hitl-flow-simplification branch

---

*This file provides direct paths to all project resources for quick context loading.*
