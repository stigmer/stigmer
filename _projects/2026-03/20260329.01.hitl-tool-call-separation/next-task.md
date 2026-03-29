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
- **Last Session**: March 29, 2026 — T01 implementation completed (both Go and Java)
- **Active Task**: T01 complete. Next: T02 (update_status Approval Preservation)
- **Plan Approved**: Yes

## Session Progress (2026-03-29)
- T01 plan reviewed and approved by user
- Identified deployment dependency between T01 and T03 (signal changes) — user confirmed T01 = atomic DB write only, signal changes deferred to T03
- Implemented Go side: `UpdateResource` on `store.Store` interface + SQLite implementation + refactored `RecordApprovalDecisionStep` + 4 unit tests including concurrent update test
- Implemented Java side: `setToolCallApproval` and `setPendingApprovals` on `AgentExecutionRepo` using MongoDB `$set` with array filters + refactored `RecordApprovalDecisionStep` + 7 updated/new unit tests
- Verified MongoDB field casing: `JsonFormat.printer()` uses lowerCamelCase (e.g., `toolCalls`, `approvalAction`, `approvalDecidedAt`)

## Files Modified

### stigmer (Go)
- `backend/libs/go/store/interface.go` — Added `UpdateResource` method to `Store` interface
- `backend/libs/go/store/sqlite/store.go` — Implemented `UpdateResource` (atomic read-modify-write under `writeMu`)
- `backend/libs/go/store/sqlite/store_test.go` — Added 4 tests: basic, not-found, modify-error-skips-write, concurrent-no-lost-writes
- `backend/services/stigmer-server/pkg/domain/agentexecution/controller/submit_approval.go` — Refactored `RecordApprovalDecisionStep` to use `UpdateResource` with TOCTOU guard

### stigmer-cloud (Java)
- `backend/services/stigmer-service/.../repo/AgentExecutionRepo.java` — Added `setToolCallApproval` (atomic `$set` with array filters) and `setPendingApprovals`
- `backend/services/stigmer-service/.../handler/AgentExecutionSubmitApprovalHandler.java` — Refactored `RecordApprovalDecisionStep` to use atomic repo methods instead of `replaceOne`
- `backend/services/stigmer-service/.../handler/AgentExecutionSubmitApprovalHandlerTest.java` — Updated tests for atomic behavior, added concurrent-race and modifiedCount==0 tests

## Next Steps
1. **T02**: update_status Approval Preservation — ensure the Python `update_status` handler does not overwrite approval decisions set by `SubmitApproval`
2. **T03**: DB-Driven Resume — change the Temporal workflow to resume based on DB state rather than signal counting, batch the signal into a single "all-approved" signal
3. **T04**: Phase Gate Relaxation — relax phase constraints so approvals can be submitted even after the workflow resumes

## Context for Resume
- T01 is **code-complete** in both repos but **not yet committed** — changes span two repositories (stigmer OSS and stigmer-cloud)
- The Go `UpdateResource` is a general-purpose addition to the store interface; any future atomic read-modify-write can use it
- The Java approach uses MongoDB-native `$set` with positional array filters — no application-level locking
- `pending_approvals` is updated in a two-phase approach: (1) atomic `$set` of approval fields, then (2) recompute + `$set` of derived `pendingApprovals` field
- Enum values in MongoDB are stored as string names (e.g., `"APPROVAL_ACTION_APPROVE"`), not numeric values

## Design Decisions
- **T01 scope narrowed**: Signal behavior unchanged in T01 (each approval sends its own Temporal signal). Signal refactoring deferred to T03 to allow independent deployment.
- **Two-phase pending_approvals update (Java)**: The critical atomicity is on `approval_action`/`approval_decided_at`. `pending_approvals` is a derived projection that tolerates brief staleness.

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
6. [ ] Continue with T02

## Quick Commands

After loading context:
- "Continue with T02" - Start the next task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
