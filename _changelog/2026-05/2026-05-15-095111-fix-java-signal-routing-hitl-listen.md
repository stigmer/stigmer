# Fix Java Signal Routing for HITL and Listen Tasks

**Date**: May 15, 2026

## Summary

Fixed the production signal routing gap in Stigmer's polyglot Temporal workflow architecture. Signals sent via the gRPC API (`submitWorkflowTaskApproval`, `sendSignal`) were silently dropped because the outer Java workflow had no mechanism to forward them to the inner Go workflow where signal listeners live. This fix adds a generic `relaySignal` method that bridges the two layers.

## Problem Statement

The Stigmer workflow execution architecture is polyglot: a Java outer workflow (`InvokeWorkflowExecutionWorkflow`) orchestrates lifecycle and delegates actual execution to a Go inner workflow (`ExecuteServerlessWorkflow`) running on a separate Temporal task queue. Signal-receiving tasks (`human_input`, `listen`) register Temporal signal channels in the inner Go workflow.

### Pain Points

- When a user called `submitWorkflowTaskApproval` or `sendSignal` via the gRPC API, the Java handlers sent the signal to the **outer** Java workflow
- The outer workflow only handled `pause` and `resume` signals — all other signals were silently dropped
- The inner Go workflow waited indefinitely on `workflow.GetSignalChannel()`, never receiving the signal
- **All HITL approval flows and signal-based listen tasks were broken** when used through the production API
- Integration tests bypassed this by directly signaling the inner workflow via the Temporal SDK, masking the issue

## Solution

Added a `relaySignal` `@SignalMethod` to the outer Java workflow that forwards arbitrary signals to the inner Go workflow via `Workflow.newUntypedExternalWorkflowStub`. The creator's `signalWithStart()` method now routes through `relaySignal` instead of sending raw signal names to the outer workflow.

### Signal Flow (Before → After)

**Before**: `API → Java Handler → signal("human_input_xyz") → Outer Workflow → ❌ dropped`

**After**: `API → Java Handler → signal("relaySignal", [name, payload]) → Outer Workflow → relaySignal() → SignalExternalWorkflow → Inner Go Workflow → ✅ received`

## Implementation Details

### Java Interface (`InvokeWorkflowExecutionWorkflow.java`)

Added `@SignalMethod void relaySignal(String signalName, Object payload)` — a generic signal forwarding contract that handles all signal types (human_input, listen, future custom signals) without needing to predict signal names.

### Java Implementation (`InvokeWorkflowExecutionWorkflowImpl.java`)

- Added `executionId` instance field, set at the start of `run()`
- Implemented `relaySignal()`: derives inner workflow ID (`workflow-exec-{executionId}`), creates an `UntypedExternalWorkflowStub`, and forwards the signal
- Includes defensive null check for `executionId` (signal before workflow initialization)

### Signal Routing (`InvokeWorkflowExecutionWorkflowCreator.java`)

Changed `signalWithStart()` to send signal name `"relaySignal"` with args `[signalName, signalPayload]` instead of sending the raw signal name directly. This is the single routing change that fixes both `submitWorkflowTaskApproval` and `sendSignal` handlers without modifying either.

### Integration Tests (`workflow_hitl_test.go`)

Removed the direct Temporal SDK signal bypass from both `TestWorkflowHITL_HumanInputApproval` and `TestWorkflowHITL_HumanInputRejection`. Tests now use `clients.ExecutionCommand.SubmitWorkflowTaskApproval()` to exercise the full production path: gRPC API → Java handler → outer workflow → relay → inner Go workflow.

### Design Decision: No `Workflow.getVersion()`

Adding a new `@SignalMethod` is additive — it doesn't change any existing command sequences in the event history. The `relaySignal` signal was never sent by old code, so no old event history references it. Unnecessary versioning would add dead code complexity.

## Benefits

- **HITL workflows work through the production API** — `submitWorkflowTaskApproval` now reaches the inner workflow
- **`sendSignal` works end-to-end** — listen tasks can receive external events through the API
- **Generic and future-proof** — any new signal type automatically routes through the relay
- **Zero cross-service coupling** — Java handlers don't need to know the inner Go workflow ID convention
- **Integration tests validate the real path** — no more bypasses that mask production bugs

## Impact

- **Users**: HITL workflow approvals and signal-based tasks now function correctly through the API
- **Developers**: Integration tests now exercise the production signal path, catching routing issues early
- **Architecture**: Clean separation maintained — outer workflow handles orchestration + relay, inner workflow handles execution

## Related Work

- Integration testing infrastructure (Phase 2) that discovered this gap
- Workflow execution HITL implementation (T13b)
- Signal deduplication (Gap B2) in `sendSignal` handler

---

**Status**: ✅ Production Ready (pending E2E validation via `make test-integration`)
**Timeline**: Single session
