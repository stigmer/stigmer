# Next Task: 20260521.02.cloud-workflow-sandbox-affinity

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260521.02.cloud-workflow-sandbox-affinity

**Description**: Implement cloud-side workflow sandbox affinity — provision dedicated Daytona sandboxes for workflow executions so all child agent calls share a single sandbox instead of provisioning N separate ones. Includes automated sandbox deprovisioning on all terminal paths.
**Goal**: Complete the cloud-side implementation: provisioning, dispatch routing, agent override wiring, lifecycle cleanup hooks, and security stripping.
**Tech Stack**: Java 21/Spring Boot/Bazel (stigmer-cloud), Go (stigmer-server), TypeScript (runner — unchanged), Temporal
**Components**: stigmer-cloud/backend/services/stigmer-service/ (sandbox, dispatch, handlers, orchestrator), backend/services/stigmer-server/ (agent dispatch)

## Current Status

**Created**: 2026-05-21
**Current Task**: T01 — Workstreams A and B complete. D unblocked.
**Status**: Workstream A (Sandbox Provisioning) and B (Dispatch Routing) are COMPLETE. Workstream D (Lifecycle Hooks) is now unblocked (depends on A). Workstreams C and E pending.

## Critical Architectural Insight

Workflow sandboxes have a **fundamentally different lifecycle** from session sandboxes:
- Sessions are long-lived → sandbox cleaned up on session DELETE (user action)
- Workflow executions are ephemeral → sandbox MUST be auto-cleaned on completion/failure/cancel/terminate
- Without lifecycle cleanup hooks, every cloud workflow leaves an orphaned Daytona VM

This is why the plan has **5 workstreams, not 4** — Workstream D (Lifecycle Hooks) is the most critical architectural piece.

## Workstream Summary (Parallel Execution)

| Workstream | Sessions | Status | Can Parallel With |
|------------|----------|--------|-------------------|
| **A: Sandbox Provisioning + Deprovisioning** | 1.5 | **COMPLETE** | B, C |
| **B: Dispatch Routing** | 1 | **COMPLETE** | A, C |
| **C: Agent Override Wiring + Security** | 1 | PENDING | A, B |
| **D: Lifecycle Hooks (Cleanup)** | 1 | **UNBLOCKED** (depends on A ✓) | After A |
| **E: Tests + Validation** | 1 | PENDING | After A+B+C+D |

**Parallel plan**: A, B, and C can each be tackled in separate conversations simultaneously. D depends on A's provisioner methods being ready. E ties everything together.

### Workstream A: Sandbox Provisioning + Deprovisioning (stigmer-cloud) — UNBLOCKED
- `SandboxTokenService.mintForWorkflowExecution()` — workflow-scoped JWT with `token_type=workflow_sandbox`
- `WorkflowSandboxRepo` — new Mongo collection `workflow_sandboxes` keyed by `execution_id`
- `WorkflowSandbox` record — parallel to `SessionSandbox` with execution lifecycle semantics
- `DaytonaSandboxProvisioner.ensureWorkflowSandbox()` — create-or-fast-path (no restart/restore for ephemeral workflows)
- `DaytonaSandboxProvisioner.deprovisionWorkflowSandbox()` — idempotent delete
- `EnsureWorkflowSandboxStep` inner class in `WorkflowExecutionCreateHandler` (after StartWorkflowStep)
- Q1 resolved: no auth-layer changes needed for new token type

### Workstream B: Dispatch Routing (stigmer-cloud)
- `WorkflowExecutionTemporalConfig` — add `activityRouting` + `defaultExecutionTarget` fields
- `WorkflowDispatchResult` — add `executionTarget` field (currently only has `baseTaskQueue`)
- `WorkflowExecutionDispatchService.resolve(WorkflowExecution)` — route to `wfexec:{id}` when routing=execution + target=CLOUD
- `StartWorkflowStep` — use dynamic dispatch result
- Kustomize config for `TEMPORAL_WORKFLOW_EXECUTION_ACTIVITY_ROUTING=execution` + `TEMPORAL_WORKFLOW_EXECUTION_DEFAULT_EXECUTION_TARGET=cloud`

### Workstream C: Agent Override Wiring + Security (stigmer-cloud + stigmer) — UNBLOCKED
- `SessionDispatchService.resolve(sessionId, activityTaskQueueOverride)` — overloaded method, returns LOCAL when override set
- `AgentExecutionCreateHandler.StartWorkflowStep` — wire `spec.getActivityTaskQueue()` as override
- `AgentExecutionRecoverHandler` — same wiring as create
- OSS `create.go` — pass 5th arg `execution.GetSpec().GetActivityTaskQueue()` to `ResolveActivityTaskQueue` (Q2: confirmed arity mismatch, compile error)
- Security: propagate `token_type` through auth chain (`PlatformClientTokenAuthenticationProvider` → `RequestCallerIdentityMapper` → `RequestCallerIdentity`), then strip `activity_task_queue` via `StripInternalFieldsStep` following `NormalizeIsPersonal` pattern (Q3: `isMachineAccount()` alone is insufficient)

### Workstream D: Lifecycle Hooks — Cleanup (stigmer-cloud, depends on A)
- `DeprovisionWorkflowSandboxActivity` — new local activity in orchestrator worker
- `InvokeWorkflowExecutionWorkflowImpl.run()` finally block — add `deprovisionWorkflowSandboxActivity.deprovision(executionId)`
- `WorkflowExecutionTerminateHandler` — add DeprovisionWorkflowSandboxStep (terminate kills workflow, finally may not run)
- `WorkflowExecutionCancelHandler` — add DeprovisionWorkflowSandboxStep (safety net, idempotent with finally)
- `WorkflowExecutionDeleteHandler` — add DeprovisionWorkflowSandboxStep (safety net)
- `WorkflowExecutionRecoverHandler` — add EnsureWorkflowSandboxStep (re-provision after previous deprovision)
- Daytona `autoDeleteInterval=1440` for workflow sandboxes (24h ultimate safety net)

### Workstream E: Tests + Validation (after A+B+C+D)
- Java unit tests for all new/modified components (token, repo, provisioner, dispatch, steps)
- Integration tests: provision, reuse, deprovision-on-complete, deprovision-on-cancel, deprovision-on-terminate, re-provision-on-recover
- Security test: `activity_task_queue` stripped from external callers
- Regression: existing session sandbox tests, existing workflow tests, `make test` in both repos

## Open Questions — ALL RESOLVED

### Q1: Token Validation Scope — RESOLVED (No Blocker)
The auth layer does NOT validate `session_id` claims against accessed resources. `PlatformClientTokenAuthenticationProvider` only checks signature/issuer/expiry via `StigmerJwtVerifier`. Resource access is enforced separately via OpenFGA on request-derived resource IDs. Workflow sandbox tokens work without auth-layer changes.

### Q2: OSS create.go Compilation — RESOLVED (Confirmed Bug)
Arity mismatch confirmed: `ResolveActivityTaskQueue` has 5 params (`dispatch.go:59`), `create.go:575` passes 4. Missing 5th arg is `activityTaskQueueOverride`. Fix: add `execution.GetSpec().GetActivityTaskQueue()` as the 5th argument.

### Q3: Internal Caller Detection — RESOLVED (Plan Assumption Corrected)
Sandbox tokens produce `isMachineAccount=false` (hardcoded in `RequestCallerIdentityMapper` for PlatformClient path). `isMachineAccount()` alone cannot distinguish sandbox callers from external users. Solution: propagate `token_type` claim through auth chain (`PlatformClientTokenAuthenticationProvider` → `PlatformClientAuthenticationToken` → `RequestCallerIdentityMapper` → `RequestCallerIdentity`). Then use `tokenType` in `StripInternalFieldsStep`. Follow `NormalizeIsPersonal` pattern. Adds ~3 files to Workstream C scope in `api-authentication` lib.

## Design Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| DD-1 | Separate `WorkflowSandboxRepo` (new collection) | Different lifecycle semantics from sessions; avoids schema migration on existing collection |
| DD-2 | Add methods to `DaytonaSandboxProvisioner` (not new class) | Same Daytona SDK, same provisioning logic; only repo and labels differ |
| DD-3 | Add `mintForWorkflowExecution()` (not generalized mint) | Explicit scope in method name; avoids changing existing callers; different JWT claims |
| DD-4 | No restart/restore for stopped workflow sandboxes — recreate | Workflow executions are one-shot; stopped sandbox = already-failed execution |
| DD-5 | Cleanup in orchestrator finally + handler safety nets | Finally handles success/fail/cancel; handler covers terminate (kills workflow) |
| DD-6 | Daytona autoDeleteInterval=1440 for workflow sandboxes | Ultimate orphan safety net; session sandboxes use -1 (disabled) |

## Key Files

### stigmer-cloud — To Create
- `.../sandbox/WorkflowSandboxRepo.java` — Mongo repo
- `.../sandbox/WorkflowSandbox.java` — record type
- `.../workflowexecution/temporal/workflow/DeprovisionWorkflowSandboxActivity.java` — local activity

### stigmer-cloud — To Modify (grouped by workstream)
**Workstream A**: `SandboxTokenService.java`, `DaytonaSandboxProvisioner.java`, `WorkflowExecutionCreateHandler.java`
**Workstream B**: `WorkflowExecutionTemporalConfig.java`, `WorkflowDispatchResult.java`, `WorkflowExecutionDispatchService.java`, `WorkflowExecutionCreateHandler.java`
**Workstream C**: `SessionDispatchService.java`, `AgentExecutionCreateHandler.java`, `AgentExecutionRecoverHandler.java`, `PlatformClientTokenAuthenticationProvider.java` (read `token_type`), `PlatformClientAuthenticationToken.java` (carry `tokenType`), `RequestCallerIdentityMapper.java` (map `tokenType`), `RequestCallerIdentity.java` (new `tokenType` field)
**Workstream D**: `InvokeWorkflowExecutionWorkflowImpl.java`, `WorkflowExecutionTemporalWorkerConfig.java`, `WorkflowExecutionTerminateHandler.java`, `WorkflowExecutionCancelHandler.java`, `WorkflowExecutionRecoverHandler.java`, `WorkflowExecutionDeleteHandler.java`

### stigmer (OSS) — To Modify
- `backend/services/stigmer-server/pkg/domain/agentexecution/controller/create.go` — wire 5th arg

### Reference (read-only, already complete)
- `backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/dispatch.go` — OSS routing logic
- `backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/config.go` — OSS config
- `backend/services/runner/src/workflows/engine-core.ts` — TS queue injection
- `backend/services/runner/src/activities/call-agent.ts` — agent queue propagation
- `_changelog/2026-05/2026-05-21-180841-workflow-sandbox-affinity-architecture.md` — OSS foundation

## Context for Resume

- Detailed plan: `_projects/2026-05/20260521.02.cloud-workflow-sandbox-affinity/tasks/T01_0_plan.md`
- OSS foundation changelog: `_changelog/2026-05/2026-05-21-180841-workflow-sandbox-affinity-architecture.md`
- Parent project: `_projects/2026-05/20260521.01.pre-deploy-integration-test-expansion/next-task.md`

## Quick Commands

After loading context:
- "Start Workstream A — Sandbox provisioning and deprovisioning infrastructure"
- "Start Workstream B — Dispatch routing"
- "Start Workstream C — Agent override wiring and security"
- "Start Workstream D — Lifecycle hooks and cleanup" (after A is done)
- "Start Workstream E — Tests and validation" (after A+B+C+D are done)
- "Show project status" — Get overview of progress
- "Resolve Q1/Q2/Q3" — Investigate open questions before coding

---

*This file provides direct paths to all project resources for quick context loading.*
