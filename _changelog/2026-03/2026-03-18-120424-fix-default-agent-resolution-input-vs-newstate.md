# Fix Default Agent Resolution: Input vs NewState Mutation Bug

**Date**: March 18, 2026

## Summary

Fixed a critical pipeline bug where resolve-default steps mutated `Input()` instead of `NewState()`, causing sessions to be persisted without `agent_instance_id`. This broke the session-first UX flow: sessions were created successfully but executions against them failed with "session has no agent_instance_id".

## Problem Statement

When a user creates a session without specifying an `agent_instance_id`, the pipeline's `ResolveDefaultAgentInstanceStep` resolves the platform default agent, creates a default instance, and sets `agent_instance_id`. Similarly, `ResolveDefaultAgentStep` resolves the default agent for executions without `session_id` or `agent_id`.

### Pain Points

- Sessions created via the session-first UX were persisted without `agent_instance_id`
- Subsequent execution creation failed: `"pipeline step CreateExecutionContext failed: resolve agent instance: session ses-xxx has no agent_instance_id"`
- The bug was silent during session creation (no error), only surfacing later during execution
- Same pattern existed in execution creation for the default agent resolution path

## Solution

Changed all resolve-default steps to mutate `ctx.NewState()` instead of `ctx.Input()`, aligning with the pipeline framework's immutability contract:

- `Input()` = original client request, **immutable** (read-only reference)
- `NewState()` = cloned copy that steps modify and `Persist` saves

Also fixed `ValidateSessionOrAgentStep` in both codebases to read from `NewState()` so it can see the resolved `agent_id`.

## Implementation Details

### Go Pipeline Framework Context

The root cause is in `context.go`:

```go
func NewRequestContext[T proto.Message](ctx context.Context, input T) *RequestContext[T] {
    return &RequestContext[T]{
        input:    input,
        newState: proto.Clone(input).(T), // Clone at construction, before any step runs
    }
}
```

`proto.Clone` creates a deep copy at construction time. After this, `input` and `newState` are independent objects. Mutating `input` in a pipeline step has no effect on what `Persist` saves.

### Java Pipeline Framework Context

In the cloud Java code, `CreateContextV2.request` is `final` and the default `setRequest()` from `ContextBase` throws `UnsupportedOperationException`. The resolve steps were calling `context.setRequest(updated)` which would crash at runtime if triggered. Fixed to use `context.setNewState(updated)`, which works correctly because `getNewState()` falls back to `request` when `newState` is null.

### Files Changed

**OSS (stigmer)**:
- `backend/services/stigmer-server/pkg/domain/session/controller/create.go` — `resolveDefaultAgentInstanceStep`: `ctx.Input()` → `ctx.NewState()`
- `backend/services/stigmer-server/pkg/domain/agentexecution/controller/create.go` — `resolveDefaultAgentStep`: `ctx.Input()` → `ctx.NewState()`; `validateSessionOrAgentStep`: `ctx.Input()` → `ctx.NewState()`

**Cloud (stigmer-cloud)**:
- `SessionCreateHandler.java` — `ResolveDefaultAgentInstanceStep`: `context.setRequest()` → `context.setNewState()`
- `AgentExecutionCreateHandler.java` — `ResolveDefaultAgentStep`: `context.setRequest()` → `context.setNewState()`; `ValidateSessionOrAgentStep`: `context.getRequest()` → `context.getNewState()`

## Benefits

- Session-first UX flow now works end-to-end (session creation → execution creation → agent execution)
- Default agent resolution path for executions (no session_id, no agent_id) now works
- Cloud Java code no longer has a dormant `UnsupportedOperationException` crash

## Impact

- **Users**: Can now use the session-first UX without encountering the "has no agent_instance_id" error
- **Developers**: Establishes the convention that pipeline steps must always modify `NewState()`, never `Input()`

## Related Work

- Session-first web UX project (`20260317.01.session-first-web-ux`)
- Execution context lifecycle (`20260307.01.execution-context-lifecycle`)

---

**Status**: ✅ Production Ready
