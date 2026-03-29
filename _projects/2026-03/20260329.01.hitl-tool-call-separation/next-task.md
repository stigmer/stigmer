# Next Task: 20260329.01.hitl-tool-call-separation

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260329.01.hitl-tool-call-separation

**Description**: Extract tool calls from the AgentExecution document into a separate MongoDB collection where each tool call is its own document. Add a dedicated RPC for tool call updates. This eliminates full-replace race conditions on concurrent approvals and reduces AgentExecution document size.
**Goal**: Separate tool calls into their own collection with individual document-level atomicity, replace full-replace update pattern with per-tool-call RPCs, and simplify the HITL approval flow so approval decisions are DB-driven rather than signal-counted.
**Tech Stack**: Go, Java, Python, Protobuf, MongoDB, Temporal, LangGraph
**Components**: stigmer-server (Go), stigmer-service (Java), agent-runner (Python/StatusBuilder), proto definitions, frontend read path

## Current State
- **Status**: code-complete
- **Last Session**: March 29, 2026 (Session 5) — T04 Phase Gate Relaxation implemented
- **Active Task**: All tasks (T01–T04) code-complete. Ready for push and PR.
- **Plan Approved**: Yes

## Session Progress (2026-03-29, Session 5)
- Implemented T04: Phase Gate Relaxation in Go and Java
- Go: Relaxed phase gate in `submit_approval.go`, added 3 contract tests + `makeExecutionWithPhase` helper
- Java: Relaxed phase gate + tool-call-centric fallback for stale `pending_approvals`, added 7 new tests in 2 nested classes
- Python: Verified no changes needed — `extract_approval_decisions_from_execution` is phase-agnostic
- Design decision: "always signal" on gate resolution regardless of phase (accepts rare spurious wake-up)
- All T04 plan items completed

## Session Progress (2026-03-29, Session 4)
- Analyzed the `DISMISS_GRACE_MS` (8s) optimistic dismissal pattern in the frontend HITL approval flow
- Confirmed it was a pre-T01 workaround now made redundant by T01 (atomic SubmitApproval) + T02 (approval field preservation) + T03 (stream publish from submitApproval)
- Removed the entire dismiss mechanism: `dismissTimestamps` state, reconciliation `useEffect`, `dismissedApprovalIds` from hook return and `MessageThread` props
- Simplified `pendingApprovals` to read directly from the execution stream (single source of truth)
- Removed optimistic dismissal tests and unused imports
- 4 files changed, 162 lines removed
- Committed: stigmer `3ba85a74`

## Session Progress (2026-03-29, Session 3)
- Implemented T03: DB-Driven Resume across all three language components
- Added `approvalGateResolved` signal constant and conditional gate logic to Go and Java SubmitApproval handlers
- Refactored Go and Java workflows from signal-counting loop to single `approvalGateResolved` wait
- Added Python DB-driven resume detection: `extract_approval_decisions_from_execution()` in `hitl.py`, checkpoint interrupt detection in `execute_graphton.py`
- Added tests: Go (3 gate check contract tests), Java (6 signal workflow tests), Python (8 decision extraction tests)
- Both repos have uncommitted T03 changes ready for commit

## Completed Tasks

### T01: Atomic SubmitApproval (Session 1)
- Go: `UpdateResource` on `store.Store` interface + SQLite implementation + refactored `RecordApprovalDecisionStep`
- Java: `setToolCallApproval` and `setPendingApprovals` on `AgentExecutionRepo` using MongoDB `$set` with array filters
- Committed: stigmer `73b98986`, stigmer-cloud `12475189`

### T02: update_status Approval Preservation (Session 2)
- Go: `approval/preserve.go` + 8 tests, wired into gRPC + Temporal handlers
- Java: `ApprovalFieldPreserver.java` + 8 tests, wired into gRPC + Temporal handlers
- Committed: stigmer `02b4ca67`, stigmer-cloud `5398e432`

### T03: DB-Driven Resume (Session 3)
- Go: Conditional `approvalGateResolved` signal in SubmitApproval, single-signal workflow wait, removed signal-counting loop
- Java: Conditional `approvalGateResolved` signal, `Workflow.await()` on boolean flag, `submitApproval` handler kept as no-op
- Python: `extract_approval_decisions_from_execution()` in `hitl.py`, LangGraph interrupt-based resume detection in `execute_graphton.py`
- Tests: Go (3), Java (6), Python (8)
- Committed: stigmer `a8f81107`, stigmer-cloud `a70b87fc`

### Frontend: Remove Optimistic Dismiss Grace (Session 4)
- Removed `DISMISS_GRACE_MS` (8s) workaround from `useSessionConversation`
- Removed `dismissedApprovalIds` from `UseSessionConversationReturn` and `MessageThreadProps` public API
- Simplified `pendingApprovals` to stream-driven (single source of truth)
- Committed: stigmer `3ba85a74`

### T04: Phase Gate Relaxation (Session 5)
- Go: Relaxed phase gate in `submit_approval.go` to allow `EXECUTION_IN_PROGRESS`, added 3 contract test functions
- Java: Relaxed phase gate in `ValidateApprovalStep`, added tool-call-centric fallback in `handleNotInPendingApprovals`, added 7 tests in 2 nested classes
- Python: No changes needed — DB-driven resume is phase-agnostic
- Committed: stigmer `pending`, stigmer-cloud `pending`

## Next Steps
1. Commit T04 changes in both repos
2. Push all T01–T04 changes to remote
3. Create PRs for both repos

## Context for Resume
- **All tasks (T01–T04) are code-complete** in both repos
- T01, T02, T03, frontend dismiss grace: committed but **not yet pushed**
- T04: uncommitted changes pending commit (Go tests + Java handler and tests)
- The field-ownership model is enforced: `SubmitApproval` owns `approval_action`, `approval_decided_at`, `approved_by`; `update_status` owns everything else
- The workflow now waits for a single `approvalGateResolved` signal per HITL cycle instead of counting N individual signals
- Python activity detects resume via LangGraph checkpoint interrupts and reads decisions from the DB-loaded execution object
- Java `submitApproval()` signal handler is kept as a no-op for Temporal interface compatibility
- Deployment is "big bang" — in-flight HITL workflows will fail with non-determinism errors on restart
- Phase gate now allows `EXECUTION_IN_PROGRESS` alongside `EXECUTION_WAITING_FOR_APPROVAL` for approval submissions

## Design Decisions
- **T01 scope narrowed**: Signal behavior unchanged in T01. Signal refactoring deferred to T03.
- **Two-phase pending_approvals update (Java)**: Critical atomicity is on `approval_action`/`approval_decided_at`. `pending_approvals` is a derived projection that tolerates brief staleness.
- **Flat index by tool_call_id**: Approval index is global, not scoped to root vs sub-agent. UUIDs guarantee uniqueness.
- **UNSPECIFIED-only overwrite**: Preservation only applies when incoming `approval_action` is UNSPECIFIED.
- **Big bang deployment (T03)**: No Temporal versioning or dual-signaling. In-flight HITL workflows break on restart.
- **Signal name `approvalGateResolved`**: Signals that the approval gate has resolved (all decided or rejected), not that workflow should resume.
- **Python backward compat (T03)**: Both Temporal-args and DB-driven decision paths are supported. Old workflows sending decisions still work.
- **Dismiss grace removal**: The 8s `DISMISS_GRACE_MS` was a pre-T01 workaround. With T01+T02+T03, `submitApproval` publishes the updated execution (with recomputed `pending_approvals`) to the stream, so the frontend gets the update within milliseconds. `submittingApprovalIds` covers the in-flight RPC window.
- **Phase gate relaxation (T04)**: Validation is now tool-call-centric, not phase-centric. The tool call's own `TOOL_CALL_WAITING_APPROVAL` status is authoritative. Execution phase is a secondary guard that only excludes terminal and pre-start states.
- **Always signal on gate resolution (T04)**: `approvalGateResolved` signal is sent on REJECT or all-decided regardless of execution phase. Temporal buffers signals; rare spurious wake-up causes one no-op Python invocation — correctness unaffected.

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260329.01.hitl-tool-call-separation/checkpoints/
```

### 2. Current Task
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260329.01.hitl-tool-call-separation/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260329.01.hitl-tool-call-separation/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260329.01.hitl-tool-call-separation/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260329.01.hitl-tool-call-separation/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260329.01.hitl-tool-call-separation/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260329.01.hitl-tool-call-separation/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
6. [ ] Commit T04 changes, push all commits, create PRs

## Quick Commands

After loading context:
- "Commit and push" - Commit remaining T04 changes, push, create PRs
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
