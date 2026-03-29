# Atomic SubmitApproval: Race Condition Fix

**Date**: March 29, 2026

## Summary

Eliminated a read-modify-write race condition in the `SubmitApproval` handler where two concurrent approval decisions for different tool calls on the same `AgentExecution` document could overwrite each other. The fix uses platform-native atomicity: mutex-protected read-modify-write in Go/SQLite and MongoDB `$set` with positional array filters in Java/MongoDB.

## Problem Statement

When multiple tool calls require human approval simultaneously, the user (or automated systems) can submit approval decisions concurrently. Both the Go and Java `SubmitApproval` handlers used a read-modify-write pattern that was not atomic:

1. Read the full `AgentExecution` document
2. Mutate the specific tool call's `approval_action` and `approval_decided_at` in memory
3. Write the full document back to the database

With concurrent requests, request B's read could happen before request A's write completes, causing B to overwrite A's approval decision with stale data.

### Pain Points

- Concurrent approval of different tool calls could silently lose one approval decision
- The lost approval caused the workflow to hang indefinitely waiting for a signal that was already sent but whose DB state was overwritten
- The bug was non-deterministic and difficult to reproduce — it required precise timing of concurrent requests
- Both Go (SQLite) and Java (MongoDB) implementations had the same structural vulnerability

## Solution

Platform-native atomic update mechanisms in both implementations, targeting only the specific fields that need to change rather than replacing the entire document.

## Implementation Details

### Go (SQLite) — `UpdateResource` on `store.Store` Interface

Added a new `UpdateResource` method to the `store.Store` interface that performs the entire read-modify-write cycle under the existing `writeMu` mutex:

```go
UpdateResource(ctx context.Context, kind apiresourcekind.ApiResourceKind,
    id string, msg proto.Message, modify func() error) error
```

The SQLite implementation acquires `writeMu` before reading, calls the `modify` callback (which mutates the deserialized proto in place), then writes the result — all while holding the lock. The previous code only held the lock during the write, leaving a race window between the read and the write.

The `RecordApprovalDecisionStep` was refactored to use `UpdateResource` with a TOCTOU guard in the modify callback: if the tool call already has a decision (concurrent request won the race), the callback returns an error and the write is skipped.

### Java (MongoDB) — Atomic `$set` with Array Filters

Added `setToolCallApproval` to `AgentExecutionRepo` using MongoDB's native atomic `updateOne` with `$set` and positional array filters. This targets only `approvalAction` and `approvalDecidedAt` on the specific tool call, regardless of whether it's in root `status.messages` or nested `status.subAgentExecutions[].messages`.

The `RecordApprovalDecisionStep` was refactored from in-memory proto mutation + `replaceOne` to: (1) atomic `$set` of approval fields, (2) re-read the document, (3) recompute and `$set` the derived `pendingApprovals` projection. Two concurrent approvals for different tool calls now update disjoint fields and never conflict.

### Files Changed

**stigmer (Go) — 4 files, +292 / -26 lines:**
- `backend/libs/go/store/interface.go` — `UpdateResource` method added to `Store` interface
- `backend/libs/go/store/sqlite/store.go` — SQLite implementation of `UpdateResource`
- `backend/libs/go/store/sqlite/store_test.go` — 4 new tests including concurrent-no-lost-writes
- `backend/services/stigmer-server/.../submit_approval.go` — Refactored `RecordApprovalDecisionStep`

**stigmer-cloud (Java) — 3 files, +275 / -105 lines:**
- `AgentExecutionRepo.java` — `setToolCallApproval`, `setPendingApprovals`, private helpers
- `AgentExecutionSubmitApprovalHandler.java` — Refactored `RecordApprovalDecisionStep`
- `AgentExecutionSubmitApprovalHandlerTest.java` — Updated tests for atomic behavior

## Benefits

- **No more lost approvals**: Concurrent SubmitApproval calls for different tool calls are now safe
- **General-purpose primitive (Go)**: `UpdateResource` can be reused for any atomic read-modify-write on any resource type
- **No application-level locking (Java)**: Uses MongoDB's built-in document-level atomicity
- **Independently deployable**: No Temporal workflow changes required — signal behavior is unchanged
- **Defensive TOCTOU handling**: Both implementations detect and reject stale concurrent updates rather than silently overwriting

## Impact

- **Agent execution reliability**: Eliminates a class of silent data loss that caused workflows to hang
- **Multi-tool-call approval flows**: Users can now safely approve multiple tool calls simultaneously without timing concerns
- **Store interface (Go)**: New `UpdateResource` method available for all future atomic-update needs

## Related Work

- Part of project `20260329.01.hitl-tool-call-separation` (T01: Atomic SubmitApproval)
- Follow-up tasks: T02 (update_status approval preservation), T03 (DB-driven resume), T04 (phase gate relaxation)
- Related changelogs: `2026-03-28-114453-fix-hitl-batch-approval-race-condition.md`, `2026-03-26-193343-fix-hitl-resume-race-condition.md`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
