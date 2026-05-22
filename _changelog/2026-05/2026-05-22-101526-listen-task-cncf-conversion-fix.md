# Fix: Listen Task CNCF Conversion in Java Validator

**Date**: May 22, 2026

## Summary

Fixed the Java `convertListenTask()` method in `InProcessWorkflowValidator` to properly transform proto-style listen config into CNCF Serverless Workflow format. The previous pass-through implementation caused all listen tasks to crash immediately, preventing signal-based workflow patterns from working.

## Problem Statement

The listen task is a core workflow primitive that blocks execution until external signals arrive. Two integration tests (`TestWorkflowListen_SignalUnblocks` and `TestWorkflowListen_AllMode`) were failing because the Java validator was not converting the proto config format into the CNCF DSL format expected by the TypeScript workflow runner.

### Pain Points

- Listen tasks crashed immediately during setup with `ApplicationFailure`, putting the execution into `EXECUTION_FAILED` phase
- Sending signals via gRPC `SendSignal` failed with `FailedPrecondition` because the execution was already failed
- The Java converter was a 1-line pass-through while the Go reference implementation had proper transformation logic

## Solution

Rewrote `convertListenTask()` in `InProcessWorkflowValidator.java` to mirror the Go reference implementation in `task_converters.go`, transforming proto-style config (`to.mode` + `to.signals`) into CNCF format (`to.one` / `to.all` / `to.any` with event filter wrappers).

## Implementation Details

The proto config arrives as:
```yaml
to:
  mode: "one"     # or "all"
  signals:
    - {id: "test_signal", type: "signal"}
```

The converter now produces CNCF-compliant output based on mode:

- **mode "one" + 1 signal**: `to.one: { with: { id, type } }` (single object)
- **mode "one" + multiple signals**: `to.any: [{ with: { id, type } }, ...]` (array)
- **mode "all"** (default): `to.all: [{ with: { id, type } }, ...]` (array)

This matches the exact structure the TypeScript runner's `extractEvents()` expects in `listen.ts`.

### Files Changed

- `stigmer-cloud: backend/services/stigmer-service/.../InProcessWorkflowValidator.java` — rewrote `convertListenTask()` (1 method, ~25 lines)

## Benefits

- Listen task workflows now execute correctly through the Java validator path
- Signal-based workflow patterns (wait-for-one, wait-for-all) are functional
- Parity between Go and Java conversion paths for listen tasks

## Impact

- **Integration tests**: 2 previously failing tests now pass (`TestWorkflowListen_SignalUnblocks`, `TestWorkflowListen_AllMode`)
- **Workflow engine**: Listen tasks can now be used in production workflows validated through the Java service

## Related Work

- Go reference implementation: `backend/services/stigmer-server/pkg/domain/workflow/converter/task_converters.go`
- TS consumer: `backend/services/runner/src/workflow-engine/tasks/listen.ts`
- Same validator class previously fixed for nested task conversion and required field validation

---

**Status**: Production Ready
