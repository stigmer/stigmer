# Session Memory Server-Side Persistence

**Date**: May 9, 2026

## Summary

Added a dedicated `updateSessionMemory` gRPC RPC and corresponding Java handler that atomically persists session memory without full-document replacement. Migrated the cursor-runner from a racy get+modify+replace pattern to a single atomic call, eliminating lost-update race conditions between concurrent session modifications.

## Problem Statement

The cursor-runner was persisting session memory by reading the full session document, setting the `status.session_memory` field, and writing the entire document back via the generic `update` RPC. This approach had two problems:

### Pain Points

- **Race condition**: `GenerateSessionSubject`, `thread_id` writes, and memory persistence all run concurrently on the same session. The read-modify-write pattern means any concurrent update between the read and write is silently lost.
- **Spec/status violation**: The `update` RPC is designed for user-facing spec changes. Writing system-managed status fields through it conflates two different authorization and audit concerns.
- **Unnecessary network overhead**: Reading the full session document just to set one field wastes bandwidth and adds latency.

## Solution

Follow the established `updateSubject` pattern — a dedicated RPC that uses atomic field-level updates rather than full-document replacement:

1. **Proto contract**: New `UpdateSessionMemoryRequest` message + `updateSessionMemory` RPC on `SessionCommandController`
2. **Java handler**: `SessionUpdateMemoryHandler` with pipeline: validate → authorize → load & set memory → respond
3. **Activity methods**: `readSessionContext` (bundles threadId + memory + cursorMode in one read) and `updateSessionMemory` (atomic `$set` for workflow-internal use)
4. **Cursor-runner migration**: `persistSessionMemory` reduced from 6 lines of get+modify+replace to 1 line

## Implementation Details

### Proto Contract (stigmer OSS)

```protobuf
message UpdateSessionMemoryRequest {
  string id = 1;
  SessionMemory session_memory = 2;
}

rpc updateSessionMemory(UpdateSessionMemoryRequest) returns (Session);
```

### Java Handler (stigmer-cloud)

`SessionUpdateMemoryHandler` — Copy-adapted from `SessionUpdateSubjectHandler`:
- Pipeline: `ValidateFieldConstraints → Authorize → LoadAndSetMemory → SendResponse`
- Key difference: Writes **status** (not spec), so audit bump targets `status_audit.updated_at`
- Uses `sessionRepo.save()` with the updated status (handler path still uses `save` for the response object, while the activity uses `$set` for atomic field-level writes)

### Temporal Activity Methods

`SessionContext` record bundles three fields into one DB read:
```java
public record SessionContext(String threadId, SessionMemory sessionMemory, int cursorMode)
```

Two new methods on `UpdateExecutionStatusActivity`:
- `readSessionContext(sessionId)` — Single query, returns `SessionContext.EMPTY` on missing
- `updateSessionMemory(sessionId, memory)` — Atomic `$set` via `JsonFormat` → `Document` → `updateFields`

### Cursor-Runner Migration

Before (racy):
```typescript
const session = await client.getSession(sessionId);
session.status.sessionMemory = memory;
await client.updateSession(session);
```

After (atomic):
```typescript
await client.updateSessionMemory(sessionId, memory);
```

## Benefits

- **Race-safe**: No more lost updates between concurrent session modifications
- **Simpler client code**: 1 RPC call instead of 3 operations (get + modify + put)
- **Correct separation**: Status updates go through a status-aware handler, not the spec-oriented `update` RPC
- **Lower latency**: No read-before-write required on the client side
- **Future-ready**: Activity method gives the workflow a local write path for Task 7's server-side merge scenarios

## Impact

- **cursor-runner**: Simplified persistence code, eliminated race condition
- **stigmer-service**: New handler + activity methods for session memory
- **All SDKs**: Generated stubs now expose `updateSessionMemory` for any client
- **Workflows (Task 7)**: `readSessionContext` provides everything needed in one call

## Related Work

- Task 5: Proto/data model updates (introduced `SessionMemory`, `SessionStatus`)
- Task 2a: Session memory extraction layer (builds the `SessionMemory` content)
- Task 2b: Continuation prompt builder (consumes the persisted memory)
- Task 3: Graceful resume-or-create (triggers memory persistence on completion)
- Task 7 (upcoming): Workflow integration using `readSessionContext`

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~2 hours)
