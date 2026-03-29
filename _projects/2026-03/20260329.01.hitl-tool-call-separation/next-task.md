# Next Task: 20260329.01.hitl-tool-call-separation

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260329.01.hitl-tool-call-separation

**Description**: Extract tool calls from the AgentExecution document into a separate MongoDB collection where each tool call is its own document. Add a dedicated RPC for tool call updates. This eliminates full-replace race conditions on concurrent approvals and reduces AgentExecution document size.
**Goal**: Separate tool calls into their own collection with individual document-level atomicity, replace full-replace update pattern with per-tool-call RPCs, and simplify the HITL approval flow so approval decisions are DB-driven rather than signal-counted.
**Tech Stack**: Go, Java, Python, Protobuf, MongoDB, Temporal, LangGraph
**Components**: stigmer-server (Go), stigmer-service (Java), agent-runner (Python/StatusBuilder), proto definitions, frontend read path

## Current State
- **Status**: in-progress
- **Last Session**: March 29, 2026 (Session 2) — T02 implementation completed (both Go and Java)
- **Active Task**: T02 complete. Next: T03 (DB-Driven Resume)
- **Plan Approved**: Yes

## Session Progress (2026-03-29, Session 2)
- T02 plan reviewed and approved
- Implemented `PreserveApprovalFields` helper in Go (`approval/preserve.go`) with 8 unit tests
- Wired into Go gRPC handler (`update_status.go`) and Temporal activity (`update_status_impl.go`)
- Implemented `ApprovalFieldPreserver` helper in Java (`ApprovalFieldPreserver.java`) with 8 unit tests
- Wired into Java gRPC handler (`AgentExecutionUpdateStatusHandler.java`) and Temporal activity (`UpdateExecutionStatusActivityImpl.java`)
- All four code paths (Go gRPC, Go Temporal, Java gRPC, Java Temporal) now preserve approval decisions during message replacement
- Both repos committed

## Completed Tasks

### T01: Atomic SubmitApproval (Session 1)
- Go: `UpdateResource` on `store.Store` interface + SQLite implementation + refactored `RecordApprovalDecisionStep`
- Java: `setToolCallApproval` and `setPendingApprovals` on `AgentExecutionRepo` using MongoDB `$set` with array filters
- Committed: stigmer `73b98986`, stigmer-cloud `12475189`

### T02: update_status Approval Preservation (Session 2)
- Go: `approval/preserve.go` + 8 tests, wired into gRPC + Temporal handlers
- Java: `ApprovalFieldPreserver.java` + 8 tests, wired into gRPC + Temporal handlers
- Committed: stigmer `02b4ca67`, stigmer-cloud `5398e432`

## Next Steps
1. **T03**: DB-Driven Resume — change the Temporal workflow to resume based on DB state rather than signal counting, batch the signal into a single "all-approved" signal
2. **T04**: Phase Gate Relaxation — relax phase constraints so approvals can be submitted even after the workflow resumes

## Context for Resume
- T01 and T02 are **code-complete and committed** in both repos but **not yet pushed**
- The field-ownership model is now enforced: `SubmitApproval` owns `approval_action`, `approval_decided_at`, `approved_by`; `update_status` owns everything else
- The Go preserve helper mutates protos in place (pointer-based); Java rebuilds immutable proto lists via `toBuilder()`
- The preservation step runs after message replacement but before `ComputePendingApprovals`, so the derived `pending_approvals` field always reflects preserved decisions
- T03 will require Temporal workflow changes — this is a coordinated deployment across Go, Java, and Python

## Design Decisions
- **T01 scope narrowed**: Signal behavior unchanged in T01 (each approval sends its own Temporal signal). Signal refactoring deferred to T03 to allow independent deployment.
- **Two-phase pending_approvals update (Java)**: The critical atomicity is on `approval_action`/`approval_decided_at`. `pending_approvals` is a derived projection that tolerates brief staleness.
- **Flat index by tool_call_id**: Approval index is global (not scoped to root vs sub-agent). UUIDs guarantee uniqueness, and this handles hypothetical cross-scope scenarios safely.
- **UNSPECIFIED-only overwrite**: Preservation only applies when incoming `approval_action` is UNSPECIFIED. If a sender ever provides a non-UNSPECIFIED value, it is respected.

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
6. [ ] Continue with T03

## Quick Commands

After loading context:
- "Continue with T03" - Start the next task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
