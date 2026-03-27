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
| **T06** | React SDK: remove polling/staleness workarounds | **COMPLETE** | T05 |
| T07 | Tests: rewrite for new architecture | Not started | T03, T04, T05 |

## Current Status

**Created**: 2026-03-27
**Current Task**: T01–T06 COMPLETE. Next: T07 (comprehensive tests) or create PRs.
**Status**: T06 Complete — React SDK `useSessionConversation` hook simplified. Removed `ApprovalLifecycleState` import (proto type deleted in T02), exponential-backoff approval polling, and timer-based staleness recovery. Simplified optimistic dismissal state from `Map<string, number>` to `Set<string>`. No public API changes — `UseSessionConversationReturn` interface unchanged.

## Session Progress (2026-03-27, Session 6)

### Accomplished
- Completed T06: React SDK polling/staleness workaround removal
- Removed `ApprovalLifecycleState` import and `ACTIONABLE_LIFECYCLE_STATES` filter (type deleted in T02)
- Deleted 5 polling/staleness constants, exponential-backoff polling useEffect (~50 lines), staleness detection useEffect (~27 lines)
- Simplified dismissed state from `Map<string, number>` + `useRef` + `useMemo` to a single `useState<ReadonlySet<string>>`
- Removed `useRef` from React imports (no longer needed)
- Removed undeclared `approvalLoadFailed` from return value (fixed type drift)
- Deleted 8 obsolete tests (polling + staleness), restructured 2 surviving tests under "optimistic dismissal" describe block
- Net: 10 insertions, 394 deletions across 2 files

### Key Decisions
- Removed both polling AND staleness detection (per user decision): trust the stream; if a Temporal signal fails, the approval stays in `pending_approvals` on subsequent stream snapshots and reappears when the user navigates away and back (dismissedApprovalIds is transient React state)
- Kept the optimistic dismissal pattern (card hidden immediately after submit) but without timestamp tracking or time-based recovery
- No changes needed to `useExecutionStream`, `useSubmitApproval`, `MessageThread`, or `ApprovalCard` — they consume `PendingApproval` fields that still exist

## Next Steps
1. **T07** (Tests): Rewrite tests for new architecture — Java integration tests, comprehensive end-to-end validation
2. Create PRs for both repos on `hitl-flow-simplification` branch
3. Consider creating PRs for T01–T06 now and T07 as a follow-up

## Context for Resume
- All changes are on the `hitl-flow-simplification` branch in both repos
- Go and Java both compile clean; Go tests pass
- React SDK changes are in `sdk/react/src/session/useSessionConversation.ts` and its test file
- The `UseSessionConversationReturn` public interface is unchanged — no breaking changes for platform builders
- `pendingApprovals` derivation now simply filters by `dismissedApprovalIds` (no lifecycle state check)
- `ApprovalLifecycleState` enum no longer exists in generated TS stubs — any other code referencing it will fail to compile

## Quick Commands

After loading context:
- "Pick next task" — T07 (Tests) or create PRs
- "Show project status" — Get overview of progress
- "Review design decisions" — Check DD-001 and DD-002
- "Create PRs" — Ready for review on hitl-flow-simplification branch

---

*This file provides direct paths to all project resources for quick context loading.*
