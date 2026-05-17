# Listen Task Converter + E2E Signal Routing Validation

**Date**: May 15, 2026

## Summary

Implemented the `convertListenTask` converter that was previously a stub, enabling proto-defined listen tasks to execute in the zigflow engine. Validated the full signal routing pipeline end-to-end (25 tests green), confirming that both `human_input` and `listen` tasks receive signals correctly through the production gRPC API path.

## Problem Statement

The `convertListenTask` method in the workflow-runner converter returned an empty `listen` map, meaning any workflow defined via Stigmer's proto API with a `listen` task would produce invalid YAML that the zigflow engine couldn't execute. Additionally, the Session 10 `relaySignal` fix for Java signal routing had not been validated with a live test run.

### Pain Points

- Proto-defined listen tasks silently produced empty YAML — no runtime error, just a task that could never receive signals
- The signal routing fix existed in code but had no end-to-end proof that it worked
- No integration test coverage for the `listen` task kind or the `SendSignal` gRPC API

## Solution

Implemented the converter to map the proto's flat `{mode, signals[]}` structure to the CNCF Serverless Workflow SDK's discriminated union under `listen.to`, then wrote two integration tests that exercise the full pipeline: proto → converter → YAML → zigflow → Temporal signal channel → gRPC signal delivery.

## Implementation Details

**Converter** (`task_converters.go`): Maps proto `ListenTaskConfig` to zigflow YAML:
- `mode:"one"` + 1 signal → `one: {with: {id, type}}` (single event filter)
- `mode:"one"` + N signals → `any: [{with: ...}, ...]` (complete on first)
- `mode:"all"` → `all: [{with: ...}, ...]` (wait for all)

**Tests** (`workflow_listen_test.go`):
- `TestWorkflowListen_SignalUnblocks`: Deploys listen task (mode "one", signal type), sends signal via `SendSignal` gRPC API, asserts completion
- `TestWorkflowListen_AllMode`: Deploys listen task (mode "all", two signals), sends both sequentially, asserts completion only after both arrive

## Benefits

- Listen tasks now work end-to-end through the proto API — closing a gap in the task family coverage
- Full signal routing validated: gRPC → Java handler → relaySignal → inner Go workflow → zigflow listen task
- Test suite expanded from 23 to 25 tests with two distinct signal delivery scenarios

## Impact

- **Workflow authors**: Can now define `listen` tasks via the proto API and have them execute correctly
- **Integration test suite**: Phase 2 task family coverage is now complete — all offline task kinds have E2E tests
- **CI confidence**: Signal routing through the Java relay layer is now covered by automated tests

## Related Work

- [fix-java-signal-routing-hitl-listen](2026-05-15-095111-fix-java-signal-routing-hitl-listen.md) — Session 10 relay fix that this session validates
- [phase2-workflow-task-family-hitl-integration-testing](2026-05-15-083907-phase2-workflow-task-family-hitl-integration-testing.md) — Phase 2 test expansion that noted the listen converter gap

---

**Status**: Production Ready
**Timeline**: ~20 minutes (converter implementation + test writing + 2 E2E runs)
