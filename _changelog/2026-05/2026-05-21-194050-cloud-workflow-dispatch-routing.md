# Cloud Workflow Execution Dispatch Routing (Workstream B)

**Date**: May 21, 2026

## Summary

Implemented cloud-side workflow execution dispatch routing in stigmer-cloud, bringing the Java dispatch layer to parity with the OSS Go implementation. When `activityRouting=execution` and `executionTarget=CLOUD`, workflow child workflows now route to per-execution task queues (`wfexec:{id}`) instead of the shared `stigmer_runner` queue. This is the routing prerequisite for sandbox affinity — Workstream A provisions a sandbox that polls the per-execution queue.

## Problem Statement

The cloud-side `WorkflowExecutionDispatchService.resolve()` was a pass-through that always returned the static global runner queue (`stigmer_runner`). With sandbox affinity, the dispatch layer must dynamically route workflows to per-execution queues when the execution target is CLOUD, enabling a dedicated sandbox to handle both the workflow and all its child agent executions on a single VM.

### Pain Points

- Cloud dispatch had no routing logic — always returned the global queue
- `signalWithStart()` in `InvokeWorkflowExecutionWorkflowCreator` hardcoded `config.getRunnerQueue()`, creating a correctness violation where the memo in SignalWithStart could disagree with the memo in `create()` for the same execution
- `WorkflowDispatchResult` used `baseTaskQueue` naming inconsistent with both the OSS Go type (`TaskQueue`) and the agent-side Java type (`taskQueue`)
- No `executionTarget` on the dispatch result — callers couldn't gate sandbox provisioning on the resolved target

## Solution

Mirrored the Go `ResolveWorkflowTaskQueue` function in the Java `WorkflowExecutionDispatchService`, following established patterns from `AgentExecutionTemporalConfig` and `SessionDispatchService`.

## Implementation Details

### Config (`WorkflowExecutionTemporalConfig`)

Added `activityRouting` (default `"global"`) and `defaultExecutionTarget` (default `"cloud"`) fields with constants. The Java default for `defaultExecutionTarget` is `"cloud"` (not `"local"` like Go) — Java code runs in cloud deployment, Go in OSS. This asymmetry matches `AgentExecutionTemporalConfig`.

### Dispatch Result (`WorkflowDispatchResult`)

Rewritten as a proper dispatch result type: renamed `baseTaskQueue` to `taskQueue`, added `executionTarget` field (resolved proto enum numeric), added `WF_EXEC_QUEUE_PREFIX` constant and `formatWfExecTaskQueue()` static helper.

### Dispatch Service (`WorkflowExecutionDispatchService`)

Replaced the zero-arg `resolve()` with `resolve(String executionId, int executionTarget)` using decomposed parameters (mirrors Go API, no repo dependency, pure function of config + inputs). Removed the dead zero-arg method per DD-B3.

### Caller Wiring

- `StartWorkflowStep`: calls `resolve(executionId, executionTargetValue)`
- `InvokeWorkflowExecutionWorkflowCreator.create()`: uses `dispatch.taskQueue()`
- `InvokeWorkflowExecutionWorkflowCreator.signalWithStart()`: now takes a required `WorkflowDispatchResult` parameter — fixes the hardcoded global queue bug
- `WorkflowExecutionSubmitWorkflowTaskApprovalHandler` and `WorkflowExecutionSendSignalHandler`: inject dispatch service, resolve dispatch before signaling

### Spring Config

Added `activity-routing: ${STIGMER_WORKFLOW_ACTIVITY_ROUTING:global}` to `application-temporal.yaml`. No `default-execution-target` YAML binding — Java field default is sufficient (matches agent execution pattern). No kustomize changes — feature activation deferred to Workstream E.

### Tests

6 test cases in `WorkflowExecutionDispatchServiceTest` mirroring the Go `dispatch_test.go` matrix: global routing (2 cases), execution routing (3 cases), format helper (1 case).

## Design Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| DD-B1 | `defaultExecutionTarget = "cloud"` in Java | Cloud-first deployment; matches `AgentExecutionTemporalConfig` pattern |
| DD-B2 | Decomposed `resolve(String, int)` not `resolve(WorkflowExecution)` | Mirrors Go API; explicit dependencies; easier to test |
| DD-B3 | Remove zero-arg `resolve()` | Single caller being updated; dead method returning incorrect results is a liability |
| DD-B4 | `signalWithStart` dispatch is required | Forces correctness; both callers have the execution loaded |
| DD-B5 | No kustomize activation | Per-execution routing without sandbox provisioning would hang workflows |
| DD-B6 | YAML binding only for `activity-routing` | Mirrors agent execution pattern; `defaultExecutionTarget` uses Java field default |

## Files Modified (stigmer-cloud)

| File | Change |
|------|--------|
| `WorkflowExecutionTemporalConfig.java` | Added routing constants, `activityRouting`, `defaultExecutionTarget` fields |
| `WorkflowDispatchResult.java` | Rewritten: `taskQueue` + `executionTarget` + `formatWfExecTaskQueue()` |
| `WorkflowExecutionDispatchService.java` | Rewritten: `resolve(String, int)` with routing logic |
| `WorkflowExecutionCreateHandler.java` | `StartWorkflowStep` uses parameterized dispatch |
| `InvokeWorkflowExecutionWorkflowCreator.java` | `create()` + `signalWithStart()` use dispatch result |
| `WorkflowExecutionSubmitWorkflowTaskApprovalHandler.java` | Injects dispatch service, resolves before signal |
| `WorkflowExecutionSendSignalHandler.java` | Injects dispatch service, resolves before signal |
| `application-temporal.yaml` | Added `activity-routing` binding |
| `WorkflowExecutionDispatchServiceTest.java` | **New**: 6 test cases |

## Impact

| Component | Change |
|-----------|--------|
| Dispatch routing | Dynamic per-execution queues when routing=execution + target=CLOUD |
| Signal delivery | Consistent queue in SignalWithStart memo (was hardcoded) |
| Config | New env var `STIGMER_WORKFLOW_ACTIVITY_ROUTING` (default: global, safe) |
| Existing behavior | Zero change — default routing is `global`, all existing paths preserved |

## Related Work

- [Workflow Sandbox Affinity Architecture](2026-05-21-180841-workflow-sandbox-affinity-architecture.md) — OSS foundation (proto, Go dispatch, TS propagation)
- Workstream A: Sandbox Provisioning (parallel, separate conversation)
- Workstream C: Agent Override Wiring + Security (pending)
- Workstream D: Lifecycle Hooks (depends on A)
- Workstream E: Tests + Validation + Feature Activation (depends on A+B+C+D)

---

**Status**: Complete (code ready, feature inactive until kustomize activation in Workstream E)
**Timeline**: Single session
