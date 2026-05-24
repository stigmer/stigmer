# Fix Agent Call Live Experience -- Cross-Language Signal Payload Mismatch

**Date**: May 24, 2026

## Summary

Fixed the root cause of the "Waiting for agent to start..." problem in the workflow execution viewer. The `child_execution_started` Temporal signal from the Java server was sent as a bare string, but the TypeScript orchestrator destructured it as an object -- silently receiving `undefined` and never emitting progress events. Added an integration test suite that exercises the full agent call event pipeline end-to-end.

## Problem Statement

When a workflow executes an `agent_call` task, the execution viewer's Agent tab showed "Waiting for agent to start..." for the entire duration, the graph badge showed a generic "Running" spinner, and no `agent_call_progress` events were ever emitted. This had been reported 3-4 times across sessions despite extensive work on the agent call live experience pipeline.

### Pain Points

- `childExecutionId` never arrived in the frontend event store, blocking the live `MessageThread` subscription
- Graph `ExecutionBadge` showed generic spinner instead of agent activity (tool name, message count)
- `agent_call_completed` events carried empty `child_execution_id`
- No integration test existed to verify the event pipeline, so the bug shipped undetected

## Solution

Two-part fix: cross-language signal handler resilience + orchestrator post-loop emission for fast-completing agents.

## Implementation Details

### Root Cause: Java/TypeScript Signal Payload Shape Mismatch

The Java `NotifyParentActivitiesImpl.signalParentExecutionStarted` sends the execution ID as a **bare string**:

```java
parentStub.signal(SIGNAL_CHILD_EXECUTION_STARTED, executionId);
// Wire format: "aex_xxx"
```

The Go `invoke_workflow_impl.go` sends the same signal as a **JSON object**:

```go
payload := struct { ExecutionID string `json:"executionId"` }{...}
workflow.SignalExternalWorkflow(gCtx, parentID, "", "child_execution_started", payload)
// Wire format: {"executionId":"aex_xxx"}
```

The TypeScript signal handler destructured the first argument as `{ executionId }`:

```typescript
setHandler(childExecutionStarted, ({ executionId }) => {
    childExecId = executionId; // undefined when arg is a plain string!
});
```

When the Java server delivered the signal (which is the path used in production and integration tests), `executionId` resolved to `undefined`, so `childExecId` was never set and no progress events were emitted.

### Fix 1: Cross-Implementation Signal Handler (`call-agent-orchestrator.ts`)

Made the signal handler accept both payload shapes:

```typescript
setHandler(childExecutionStarted, (payload) => {
    if (typeof payload === "string") {
        childExecId = payload;            // Java sends bare string
    } else if (payload?.executionId) {
        childExecId = payload.executionId; // Go sends object
    }
});
```

### Fix 2: Post-Loop Progress Emission (`call-agent-orchestrator.ts`)

Added emission after the orchestrator loop exits to handle the fast-completion race (agent finishes before the first 15s poll):

```typescript
if (childExecId && !initialProgressEmitted) {
    await emitProgress(input, childExecId, null);
}
// Also populate agent_execution_id on the result for agent_call_completed
if (childExecId && !activityResult.agent_execution_id) {
    activityResult = { ...activityResult, agent_execution_id: childExecId };
}
```

### Integration Test Suite (3 tests, new)

Created `workflow_agent_call_live_events_test.go` with:

- **TestWorkflowAgentCall_LiveEventsEmitted**: Verifies `execution_started`, `task_started`, `agent_call_started`, terminal events all arrive in correct order
- **TestWorkflowAgentCall_ProgressEventsHaveChildExecutionId**: Verifies at least one event carries a non-empty `child_execution_id` and the child `AgentExecution` exists
- **TestWorkflowAgentCall_EventsPersistedAndStreamable**: Verifies events survive persistence and are retrievable via `getEventLog`

Created `harness/event_collector.go` -- reusable helper that subscribes to `subscribeEvents` gRPC stream and provides `WaitForEventType` with timeout.

### SDK Unit Tests (2 tests, extended)

Extended `agent-call-live-experience.test.ts` with:

- Full realistic lifecycle event sequence test (execution_started through completion with progress events)
- Progress-without-started edge case test (verifies agentActivity gate requires `agentSlug` from `agent_call_started`)

## Benefits

- `childExecutionId` now propagates correctly regardless of whether Go or Java server sends the signal
- Agent call tasks show live progress in the execution viewer (tool names, message counts, live transcript)
- `agent_call_completed` events now carry the `child_execution_id` for post-hoc analysis
- Integration test catches regressions in the event pipeline going forward
- `EventCollector` harness helper is reusable for future event-based integration tests

## Impact

- **Desktop + Web app users**: Agent tab transitions from "Waiting for agent to start..." to live `MessageThread` when `childExecutionId` arrives
- **Graph badges**: Running `agent_call` nodes show tool name or message count instead of generic spinner
- **Waterfall**: Agent call sub-spans now correlate with the correct child execution
- **Integration test coverage**: First workflow event streaming integration test in the suite

## Related Work

- Agent Call Live Experience (earlier session -- laid the backend foundation)
- Agent Call Live Progress Pipeline Fix (earlier session -- added event store handler and periodic polling)
- Runner Execution Pipeline Errors Fix (earlier session -- unblocked child agent execution)

---

**Status**: Production Ready (runner rebuilt, integration tests green)
**Timeline**: Single session -- diagnosis via test-first methodology
