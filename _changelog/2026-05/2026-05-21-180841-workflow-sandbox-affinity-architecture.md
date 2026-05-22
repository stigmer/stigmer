# Workflow Execution Sandbox Affinity — Proto + Dispatch + Runner Propagation

**Date**: May 21, 2026

## Summary

Introduced the Workflow Sandbox Affinity architecture: workflow executions in cloud mode can now provision a single dedicated sandbox that is shared by the workflow AND all its child agent executions (`call:agent` tasks). This eliminates N separate sandbox cold starts for a workflow with N agent calls. The implementation adds `execution_target` to WorkflowExecutionSpec, `activity_task_queue` to AgentExecutionSpec, a new workflow dispatch layer with per-execution queue routing, and TS runner propagation that passes the parent queue across the gRPC boundary to child agent creations.

## Problem Statement

In cloud mode, workflow executions ran on the global `stigmer_runner` queue. Each `call:agent` task within a workflow created a new session, which triggered a new Daytona sandbox provision. A workflow with N sequential agent calls incurred N sandbox cold starts (5-30s each) and N+1 total VMs — with no compute reuse between the workflow engine and the agents it orchestrated.

### Pain Points

- N sandbox cold starts per workflow (5-30s each for Daytona provisioning)
- N+1 total VMs wasted (1 for workflow runner + N for individual agents)
- Asymmetry between local mode (single runner handles everything) and cloud mode (separate sandboxes per entity)
- Sessions (agent-specific by design) should not carry infrastructure routing fields

## Solution

Six-layer implementation that enables sandbox sharing without conflating workflow execution with the session concept:

1. **Proto**: Added `execution_target` (field 8) to `WorkflowExecutionSpec` using the existing `session.v1.ExecutionTarget` enum. Added `activity_task_queue` (field 11) to `AgentExecutionSpec` as an internal-only routing override.
2. **Workflow Dispatch (Go)**: New `ResolveWorkflowTaskQueue()` function resolves to `wfexec:{execution_id}` when `execution_target=CLOUD` and routing=execution.
3. **Config Extension (Go)**: Added `WorkflowActivityRouting` and `DefaultExecutionTarget` to workflow execution temporal config.
4. **Orchestrator Routing (Go)**: `WorkflowCreator.Create()` now accepts a resolved queue parameter, passing it in the `runnerTaskQueue` memo.
5. **Runner Propagation (TS)**: `engine-core.ts` injects `__stigmer_activity_task_queue` from `workflowInfo().taskQueue`. `call-agent.ts` reads this and sets `activityTaskQueue` on child AgentExecution when in a `wfexec:` scoped sandbox.
6. **Agent Dispatch Override (Go)**: `ResolveActivityTaskQueue()` accepts an `activityTaskQueueOverride` parameter; when non-empty, routes directly to that queue with `ExecutionTarget=LOCAL` (prevents double-provisioning).

## Implementation Details

### Queue Naming Convention

| Entity | Queue Name | Example |
|--------|-----------|---------|
| Global (all runner work) | `stigmer_runner` | `stigmer_runner` |
| Agent (per-session) | `session:{session_id}` | `session:ses_abc123` |
| Workflow (per-execution) | `wfexec:{execution_id}` | `wfexec:wfx_def456` |

### Key Design Decisions

- **D1**: `execution_target` on WorkflowExecutionSpec (not Session) — first routing intent on the proto
- **D2**: `activity_task_queue` on AgentExecutionSpec (not Session) — execution is ephemeral, session is long-lived
- **D3**: Propagation via `__stigmer_activity_task_queue` env var — mirrors existing `__stigmer_*` pattern
- **D4**: Activities from TS workflow inherit its queue automatically (no explicit routing needed within engine)
- **D5**: Override returns `ExecutionTarget=LOCAL` — prevents cloud `EnsureSessionSandboxStep` from firing

### Files Modified (stigmer OSS)

- `apis/ai/stigmer/agentic/workflowexecution/v1/spec.proto` — added `execution_target` field 8
- `apis/ai/stigmer/agentic/agentexecution/v1/spec.proto` — added `activity_task_queue` field 11
- `apis/stubs/go/...` and `apis/stubs/ts/...` — regenerated stubs
- `backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/config.go` — routing + target config
- `backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/dispatch.go` — NEW dispatch layer
- `backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/dispatch_test.go` — 6 new tests
- `backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/workflows/workflow_creator.go` — queue param
- `backend/services/stigmer-server/pkg/domain/workflowexecution/controller/create.go` — dispatch integration
- `backend/services/stigmer-server/pkg/domain/workflowexecution/controller/send_signal.go` — API update
- `backend/services/stigmer-server/pkg/domain/workflowexecution/controller/workflowexecution_controller.go` — config field
- `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/dispatch.go` — override parameter
- `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/dispatch_test.go` — 3 new tests + updated 10 calls
- `backend/services/runner/src/workflows/engine-core.ts` — inject `__stigmer_activity_task_queue`
- `backend/services/runner/src/activities/call-agent.ts` — propagate affinity to child executions

### Files Modified (stigmer-cloud)

- All stub files regenerated via `make protos` (Java, Go, Python, TS, Dart)

## Benefits

- **Cloud latency reduction**: Workflow with N agent calls pays 1 sandbox cold start instead of N
- **Resource efficiency**: 1 VM instead of N+1 for workflow + agent workloads
- **Local/cloud parity**: Cloud mode now replicates the efficiency of local mode (single runner handles all)
- **Clean separation**: Sessions remain agent-specific — no infrastructure fields added
- **Backward compatible**: OSS defaults to `global` routing; existing workflows unchanged
- **Security**: `activity_task_queue` only accepted from internal callers (stripped from external API)

## Impact

| Component | Change |
|-----------|--------|
| Proto contract | 2 new optional fields (additive, non-breaking) |
| Go dispatch (workflow) | New layer: `ResolveWorkflowTaskQueue()` |
| Go dispatch (agent) | Override parameter on existing function |
| Go orchestrator routing | Dynamic queue in memo |
| TS workflow engine | One env var injection (`__stigmer_activity_task_queue`) |
| TS CallAgent activity | Conditional propagation of parent queue |
| Cloud sandbox provisioning | `EnsureWorkflowSandboxStep` (Java-side, not yet implemented — next phase) |
| Integration tests | 9 new test cases validating dispatch routing |

## Related Work

- [Workstream B: Orchestrator Rewrite](2026-05-21-174307-workstream-b-orchestrator-rewrite-pause-resume.md) — prerequisite (child workflow dispatch + queue unification)
- [TS Hydration Activity](2026-05-21-164357-ts-hydration-activity-wrapper-workflow.md) — workflow engine foundation
- Pre-deploy integration test expansion project — `_projects/2026-05/20260521.01.pre-deploy-integration-test-expansion/`
- Plan: `.cursor/plans/workflow_sandbox_affinity_a90709b5.plan.md`

---

**Status**: Foundation Complete (proto + Go dispatch + TS propagation). Cloud-side sandbox provisioning step (Java `EnsureWorkflowSandboxStep`) is the next phase.
**Timeline**: Single session (~30 minutes)
