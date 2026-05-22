# Workstream A: Workflow Sandbox Provisioning + Deprovisioning Infrastructure

**Date**: May 21, 2026

## Summary

Implemented the cloud-side workflow sandbox provisioning infrastructure in stigmer-cloud. Workflow executions with `execution_target=CLOUD` and per-execution routing now get a dedicated Daytona sandbox provisioned pre-persist in the create handler pipeline, shared by the workflow and all its child agent executions. This eliminates N cold starts for N-agent workflows.

## Problem Statement

In cloud mode, each `call:agent` task within a workflow triggered a separate Daytona sandbox provision. A workflow with N sequential agent calls incurred N sandbox cold starts (5-30s each) and N+1 total VMs. The OSS foundation (proto fields, Go dispatch, TS propagation) was complete, but the cloud-side had no workflow sandbox support.

### Pain Points

- N sandbox cold starts per workflow (5-30s each)
- N+1 total VMs wasted per workflow
- No automated lifecycle management for workflow sandboxes (unlike sessions which are user-deleted)
- Workflow sandboxes need fundamentally different semantics than session sandboxes (one-shot, no restart on idle)

## Solution

Layered approach: extended the existing `SandboxProvisioner` interface with workflow-specific methods, added a new `WorkflowSandbox` record + `WorkflowSandboxRepo` (separate Mongo collection), and inserted a critical `EnsureWorkflowSandboxStep` in the create handler pipeline at the correct position (pre-persist, pre-start-workflow).

## Implementation Details

### New Files (stigmer-cloud)
- `WorkflowSandbox.java` — Record type keyed by `executionId`, mirrors `SessionSandbox` with one-shot lifecycle semantics
- `WorkflowSandboxRepo.java` — MongoDB `workflow_sandboxes` collection with unique index on `execution_id`
- `EnsureWorkflowSandboxStepTest.java` — 8 unit tests covering gates, success, and critical failure paths

### Modified Files (stigmer-cloud)
- `SandboxProvisioner.java` — Added `ensureWorkflowSandbox()` + `deprovisionWorkflowSandbox()` to interface
- `NoopSandboxProvisioner.java` — Added no-op implementations
- `DaytonaSandboxProvisioner.java` — Full workflow provisioning/deprovisioning implementation (recreate-on-stop, 24h auto-delete, workflow-specific labels)
- `SandboxProvisionerConfig.java` — Updated bean factory to inject `WorkflowSandboxRepo`
- `SandboxTokenService.java` — Added `mintForWorkflowExecution()` with `token_type=workflow_sandbox` claims
- `WorkflowExecutionCreateHandler.java` — Added `EnsureWorkflowSandboxStep` (critical, between createAuthorizationTuples and createExecutionContext)
- `DaytonaSandboxProvisionerTest.java` — 11 new workflow sandbox tests
- `SandboxTokenServiceTest.java` — Added workflow token minting tests

### Key Architectural Decision: Pipeline Ordering

The step is placed BEFORE persist and BEFORE startWorkflow (not after, like the session sandbox step). This ensures:
- Zero orphaned state on failure (no DB records, no Temporal workflow)
- Sandbox guaranteed running before workflow starts (zero race condition)
- Tradeoff: create API blocks 5-30s (acceptable for batch workflows)

### Key Architectural Decision: Interface Extension

Added workflow methods to `SandboxProvisioner` interface (not bypass via cast). Clean Spring DI, future-proof for alternative provisioners.

### Deprovisioning Contract

`deprovisionWorkflowSandbox` is idempotent (no-record → silent return, Daytona 404 → clean repo) but throws `SandboxProvisioningException` on transient errors for Temporal activity retry in Workstream D.

## Benefits

- Single sandbox cold start per workflow (instead of N)
- Single VM per workflow + all child agents (instead of N+1)
- Fail-fast semantics: user knows immediately if provisioning fails
- Clean error message with `UNAVAILABLE` status code (retry-safe)
- Zero impact on existing session sandbox path

## Impact

| Component | Change |
|-----------|--------|
| `SandboxProvisioner` interface | Additive (2 new methods) |
| `DaytonaSandboxProvisioner` | Workflow methods + constructor param |
| `WorkflowExecutionCreateHandler` pipeline | New critical step at position 11 (pre-persist) |
| MongoDB | New collection `workflow_sandboxes` |
| Token claims | New `workflow_execution_id` + `token_type=workflow_sandbox` |
| Daytona settings | `autoStop=30min`, `autoArchive=5min`, `autoDelete=1440min` for workflow sandboxes |

## Related Work

- [OSS Foundation](2026-05-21-180841-workflow-sandbox-affinity-architecture.md) — Proto + Go dispatch + TS propagation
- Project: `_projects/2026-05/20260521.02.cloud-workflow-sandbox-affinity/`
- Workstream D (Lifecycle Hooks) depends on this — uses `deprovisionWorkflowSandbox()` from orchestrator finally block + handler safety nets
- Workstream C (Agent Override Wiring) depends on dispatch routing added in a prior session

---

**Status**: Complete (Workstream A scope)
**Timeline**: Single session
