# Task T01: Cloud Workflow Sandbox Affinity — Revised Plan

**Created**: 2026-05-21
**Status**: Planning
**Predecessor**: [20260521.01.pre-deploy-integration-test-expansion](../../20260521.01.pre-deploy-integration-test-expansion/) — Sandbox Affinity session (OSS foundation)

## Problem Statement

In cloud mode, workflow executions run on the global `stigmer_runner` queue. Each `call:agent` task within a workflow creates a new session, which triggers a new Daytona sandbox provision. A workflow with N sequential agent calls incurs N sandbox cold starts (5-30s each) and N+1 total VMs.

The OSS-side foundation (proto, Go dispatch, TS propagation) is complete. The cloud-side has no workflow sandbox support — only session-scoped sandboxes via `EnsureSessionSandboxStep`.

## Why This Cannot Be a Copy-Paste of Session Sandboxes

Session sandboxes and workflow sandboxes have **fundamentally different lifecycle semantics**:

| Aspect | Session Sandbox | Workflow Sandbox |
|--------|----------------|------------------|
| **Scope** | Long-lived session (many executions) | Single ephemeral execution |
| **Provisioned when** | Agent execution create/recover | Workflow execution create/recover |
| **Deprovisioned when** | Session DELETE | Workflow reaches terminal phase (complete/fail/cancel/terminate) |
| **Token lifetime** | Hours (4h TTL, survives many executions) | Minutes to hours (single execution) |
| **Reuse pattern** | Multiple agent executions reuse one sandbox | One workflow + N child agents share one sandbox |
| **Restart on idle** | Yes (Daytona auto-stop → restart on next execution) | No (execution is one-shot; if sandbox stops, execution fails) |
| **Cleanup trigger** | Explicit user action (session delete) | Automated (orchestrator finally block + handler safety nets) |
| **Orphan risk** | Low (user deletes sessions) | High (orchestrator crash, terminate kills workflow) |

**Critical implication**: Session sandboxes have NO automated deprovisioning — they rely on the user deleting the session. Workflow sandboxes MUST have automated deprovisioning because workflow executions are fire-and-forget. Without it, every workflow leaves an orphaned Daytona VM.

## Architecture Decision: Separate vs Generalized Infrastructure

### Decision: Use a **layered approach** — shared provisioning core, separate lifecycle management

**Rationale**:
- The Daytona SDK calls (create, restart, delete) are identical regardless of scope
- But the repo, keying, lifecycle hooks, and deprovisioning triggers are fundamentally different
- Generalizing the interface (renaming `sessionId` → `scopeId`) would touch every existing session sandbox caller for zero behavioral benefit
- A new `WorkflowSandboxService` that composes with the existing `DaytonaSandboxProvisioner` provides clean separation without code duplication

### Concrete Structure

```
SandboxProvisioner (interface — unchanged)
  └── DaytonaSandboxProvisioner (implementation — extended with overloaded methods)
        ├── ensureSandbox(String sessionId, SandboxEnvironment env)      ← existing, unchanged
        ├── ensureWorkflowSandbox(String executionId, SandboxEnvironment env)  ← new
        ├── deprovisionSandbox(String sessionId)                        ← existing, unchanged
        └── deprovisionWorkflowSandbox(String executionId)              ← new

SessionSandboxRepo (unchanged — session_sandboxes collection)
WorkflowSandboxRepo (new — workflow_sandboxes collection, keyed by execution_id)

SandboxTokenService
  ├── mintForSession(...)        ← existing, unchanged
  └── mintForWorkflowExecution(...)  ← new
```

This avoids:
- Changing the `SandboxProvisioner` interface (which `NoopSandboxProvisioner` also implements)
- Modifying `SessionSandboxRepo` or its Mongo collection
- Renaming `SandboxEnvironment.sessionId` (which is used in labels and logs)
- Breaking any existing session sandbox behavior

---

## Workstream Summary (Parallel Execution)

| Workstream | Scope | Can Parallel With | Estimated Effort |
|------------|-------|-------------------|------------------|
| **A: Sandbox Provisioning + Deprovisioning** | Token, repo, provisioner, EnsureWorkflowSandboxStep, DeprovisionWorkflowSandboxActivity | B, C | ~1.5 sessions |
| **B: Dispatch Routing** | WorkflowExecutionDispatchService, config, StartWorkflowStep | A, C | ~1 session |
| **C: Agent Override Wiring + Security** | SessionDispatchService, agent handler, OSS 5th arg, field stripping | A, B | ~1 session |
| **D: Lifecycle Hooks (Cleanup)** | Orchestrator finally, cancel/terminate/recover/delete handlers | Depends on A | ~1 session |
| **E: Tests + Validation** | Java unit tests, integration tests, regression | Depends on A+B+C+D | ~1 session |

**Parallel plan**: A, B, and C are fully independent and can be done in three separate conversations. D depends on A's provisioner being ready. E ties everything together.

---

## Workstream A: Sandbox Provisioning + Deprovisioning

**Repo**: stigmer-cloud
**Packages**: `ai.stigmer.domain.agentic.sandbox`, `ai.stigmer.domain.agentic.workflowexecution.request.handler`

### A.1: `SandboxTokenService` — add `mintForWorkflowExecution`

**File**: `.../sandbox/SandboxTokenService.java`

Add a new method (do NOT modify `mintForSession`):
```java
public static final String CLAIM_WORKFLOW_EXECUTION_ID = "workflow_execution_id";
public static final String TOKEN_TYPE_WORKFLOW_SANDBOX = "workflow_sandbox";

public SandboxToken mintForWorkflowExecution(String identityAccountId, String executionId, String orgId) {
    // Same signing key and TTL as session tokens
    // Claims: sub=identityAccountId, workflow_execution_id=executionId,
    //         token_type=workflow_sandbox, org=orgId
}
```

**Q1 resolved — no auth changes needed**: The auth layer does NOT validate `session_id` claims. `PlatformClientTokenAuthenticationProvider` only checks signature/issuer/expiry. A `workflow_sandbox` token with `workflow_execution_id` instead of `session_id` authenticates through the existing path without changes.

### A.2: `WorkflowSandboxRepo` — new Mongo collection

**New file**: `.../sandbox/WorkflowSandboxRepo.java`
**Collection**: `workflow_sandboxes`
**Unique index**: `execution_id`

Record type `WorkflowSandbox` (new file, parallel to `SessionSandbox`):
```java
public record WorkflowSandbox(
    String executionId,      // workflow execution this sandbox serves
    String sandboxId,        // Daytona sandbox ID
    String provider,         // "daytona"
    Status status,           // PROVISIONING, RUNNING, STOPPED, ARCHIVED, FAILED
    Instant createdAt,
    Instant lastActiveAt,
    Instant tokenExpiresAt
) { /* same status enum, same isTokenStale method */ }
```

**Why separate from SessionSandboxRepo**: Different keying (executionId vs sessionId), different lifecycle (auto-deprovision vs user-triggered), and different deprovisioning hooks. Sharing the collection would require a discriminator field and compound indexes, adding complexity for no benefit.

### A.3: Extend `DaytonaSandboxProvisioner` — workflow sandbox methods

Add parallel methods alongside existing session methods:

```java
public WorkflowSandbox ensureWorkflowSandbox(String executionId, SandboxEnvironment env) {
    // Same Daytona provisioning logic as ensureSandbox
    // Uses WorkflowSandboxRepo instead of SessionSandboxRepo
    // Labels: stigmer.ai/workflow-execution-id, stigmer.ai/org
    // Key difference: NO restart/restore on auto-stop (workflow is one-shot)
    //   → If sandbox is stopped/archived, recreate (workflow may have timed out anyway)
}

public void deprovisionWorkflowSandbox(String executionId) {
    // Same delete logic as deprovisionSandbox
    // Uses WorkflowSandboxRepo
}
```

**Design decision on restart**: Unlike session sandboxes, workflow sandboxes should NOT be restarted from stopped/archived state. If Daytona auto-stopped the sandbox, the workflow execution is likely already failed (activity timed out). The `ensureWorkflowSandbox` method should only handle the fast path (already running) and creation (new). For stopped/archived, recreate from scratch.

**Auto-stop/archive settings**: Workflow sandboxes should use different Daytona settings:
- `autoStopIntervalMinutes`: Lower than session (e.g., 30 instead of 120) — workflow should complete faster
- `autoArchiveIntervalMinutes`: Same as session (5 min after stop)
- `autoDeleteInterval`: Consider enabling (e.g., 1440 = 24h) as an orphan safety net — session sandboxes disable this

### A.4: `SandboxEnvironment` — decide on generalization

**Option chosen**: Keep `SandboxEnvironment` as-is and pass the workflow execution ID in the `sessionId` field with a `wfexec:` prefix. The `sessionId` field is only used for:
1. Logs — prefix makes the scope clear
2. The `taskQueue` field carries the actual queue name (`wfexec:{id}`)
3. Daytona labels use separate logic per method (session labels vs workflow labels)

Alternative: Create `WorkflowSandboxEnvironment` as a separate record. This is cleaner but adds another DTO for identical fields. Tradeoff: clarity vs duplication. **Implementer should decide based on how it reads in the code.**

### A.5: `EnsureWorkflowSandboxStep` — inner class in `WorkflowExecutionCreateHandler`

**File**: `.../workflowexecution/request/handler/WorkflowExecutionCreateHandler.java`
**Position**: After `startWorkflowStep` (step 13), before `commonSteps.publish` (step 14)

```java
static class EnsureWorkflowSandboxStep implements RequestPipelineStepV2<CreateContextV2<WorkflowExecution>> {
    private final DaytonaSandboxProvisioner sandboxProvisioner;
    private final SandboxProvisionerConfig sandboxConfig;
    private final WorkflowExecutionDispatchService dispatchService;
    private final SandboxTokenService sandboxTokenService;

    @Override
    public RequestPipelineStepResultV2 execute(CreateContextV2<WorkflowExecution> context) {
        WorkflowExecution execution = context.getNewState();
        String executionId = execution.getMetadata().getId();

        if ("noop".equalsIgnoreCase(sandboxConfig.getType())) {
            return RequestPipelineStepResultV2.success(getName());
        }

        // Gate: only provision for CLOUD + execution routing
        WorkflowDispatchResult dispatch = dispatchService.resolve(execution);
        if (!dispatch.taskQueue().startsWith("wfexec:")) {
            return RequestPipelineStepResultV2.success(getName());
        }

        String orgId = execution.getMetadata().getOrg();
        String identityAccountId = InterceptorContextHolder.getContext()
                .map(ctx -> ctx.getCaller().getIdentityAccountId())
                .orElse(null);

        try {
            SandboxTokenService.SandboxToken token = (identityAccountId != null)
                ? sandboxTokenService.mintForWorkflowExecution(identityAccountId, executionId, orgId)
                : null;

            var env = new SandboxEnvironment(
                executionId, dispatch.taskQueue(), orgId,
                sandboxConfig.getBackendEndpoint(),
                sandboxConfig.getTemporalAddress(),
                sandboxConfig.getProxyEndpoint(),
                token != null ? token.jwt() : null,
                token != null ? token.expiresAt() : null);

            sandboxProvisioner.ensureWorkflowSandbox(executionId, env);
        } catch (Exception e) {
            log.warn("Workflow sandbox provisioning failed (non-fatal): execution={}, error={}",
                executionId, e.getMessage());
        }

        return RequestPipelineStepResultV2.success(getName());
    }

    @Override
    public boolean isCritical() { return false; }
}
```

**Important**: The step type-hints `DaytonaSandboxProvisioner` directly (not the `SandboxProvisioner` interface) because `ensureWorkflowSandbox` is a new method that only `DaytonaSandboxProvisioner` implements. The `NoopSandboxProvisioner` path is handled by the `sandboxConfig.getType()` gate.

### A.6: `NoopSandboxProvisioner` — no changes needed

The `"noop"` type gate in the pipeline step means `NoopSandboxProvisioner` is never called for workflow sandboxes. No changes needed.

---

## Workstream B: Dispatch Routing

**Repo**: stigmer-cloud
**Package**: `ai.stigmer.domain.agentic.workflowexecution.temporal`

### B.1: Extend `WorkflowExecutionTemporalConfig`

**File**: `.../workflowexecution/temporal/WorkflowExecutionTemporalConfig.java`

Add (mirroring `AgentExecutionTemporalConfig`):
```java
public static final String ROUTING_GLOBAL = "global";
public static final String ROUTING_EXECUTION = "execution";
public static final String DEFAULT_EXECUTION_TARGET_LOCAL = "local";
public static final String DEFAULT_EXECUTION_TARGET_CLOUD = "cloud";

private String activityRouting = ROUTING_GLOBAL;
private String defaultExecutionTarget = DEFAULT_EXECUTION_TARGET_LOCAL;
```

**Env vars**: `TEMPORAL_WORKFLOW_EXECUTION_ACTIVITY_ROUTING`, `TEMPORAL_WORKFLOW_EXECUTION_DEFAULT_EXECUTION_TARGET`

**Note**: Default is `local` (matching OSS `config.go`), NOT `cloud` like `AgentExecutionTemporalConfig`. Cloud deploys override via kustomize.

### B.2: Extend `WorkflowDispatchResult`

**File**: `.../workflowexecution/temporal/dispatch/WorkflowDispatchResult.java`

Current: `record WorkflowDispatchResult(String baseTaskQueue)`

New: Add execution target for the sandbox provisioning gate:
```java
public record WorkflowDispatchResult(
    String taskQueue,           // was baseTaskQueue
    int executionTarget         // proto enum numeric: 1=LOCAL, 2=CLOUD
) {}
```

**Breaking change**: `baseTaskQueue` → `taskQueue`. Update all callers (only `StartWorkflowStep` and `InvokeWorkflowExecutionWorkflowCreator`).

### B.3: Rewrite `WorkflowExecutionDispatchService.resolve()`

**File**: `.../workflowexecution/temporal/dispatch/WorkflowExecutionDispatchService.java`

Current: `resolve()` returns static `runnerQueue`.

New: Accept `WorkflowExecution`, mirror OSS `ResolveWorkflowTaskQueue` logic:
```java
public WorkflowDispatchResult resolve(WorkflowExecution execution) {
    int target = resolveExecutionTarget(execution.getSpec().getExecutionTargetValue());

    if (ROUTING_EXECUTION.equals(config.getActivityRouting())
            && target == ExecutionTarget.EXECUTION_TARGET_CLOUD_VALUE) {
        String taskQueue = formatWfExecTaskQueue(execution.getMetadata().getId());
        return new WorkflowDispatchResult(taskQueue, target);
    }

    return new WorkflowDispatchResult(config.getRunnerQueue(), target);
}

// Keep zero-arg resolve() for backward compat (returns global + LOCAL)
public WorkflowDispatchResult resolve() {
    return new WorkflowDispatchResult(config.getRunnerQueue(),
        ExecutionTarget.EXECUTION_TARGET_LOCAL_VALUE);
}

public static String formatWfExecTaskQueue(String executionId) {
    return "wfexec:" + executionId;
}
```

### B.4: Update `StartWorkflowStep`

**File**: `WorkflowExecutionCreateHandler.java` → `StartWorkflowStep` inner class

Change: `dispatchService.resolve()` → `dispatchService.resolve(execution)`

The workflow creator already passes the task queue as a memo (`runnerTaskQueue`). The Java orchestrator (`InvokeWorkflowExecutionWorkflowImpl`) reads this memo to start the child workflow on the correct queue. No changes needed to the orchestrator.

### B.5: Kustomize config

Add to cloud deployment overlays:
```yaml
- name: TEMPORAL_WORKFLOW_EXECUTION_ACTIVITY_ROUTING
  value: "execution"
- name: TEMPORAL_WORKFLOW_EXECUTION_DEFAULT_EXECUTION_TARGET
  value: "cloud"
```

---

## Workstream C: Agent Override Wiring + Security

**Repos**: stigmer-cloud + stigmer

### C.1: Extend `SessionDispatchService` — accept override

**File**: `.../agentexecution/temporal/dispatch/SessionDispatchService.java`

Add overloaded method (do NOT modify existing `resolve(sessionId)`):
```java
public DispatchResult resolve(String sessionId, String activityTaskQueueOverride) {
    if (activityTaskQueueOverride != null && !activityTaskQueueOverride.isEmpty()) {
        // Load session only for harness (NATIVE vs CURSOR)
        int harness = 0;
        if (sessionId != null && !sessionId.isEmpty()) {
            sessionRepo.findById(sessionId).ifPresent(s ->
                harness = s.getSpec().getHarnessValue());
        }
        return new DispatchResult(
            activityTaskQueueOverride,
            harness,
            ExecutionTarget.EXECUTION_TARGET_LOCAL_VALUE  // prevents double-provisioning
        );
    }
    return resolve(sessionId);
}
```

### C.2: Wire `activity_task_queue` in cloud agent create handler

**File**: `AgentExecutionCreateHandler.java` → `StartWorkflowStep`

Change the dispatch call:
```java
// Before:
DispatchResult dispatch = dispatchService.resolve(execution.getSpec().getSessionId());

// After:
DispatchResult dispatch = dispatchService.resolve(
    execution.getSpec().getSessionId(),
    execution.getSpec().getActivityTaskQueue()
);
```

Same change in `EnsureSessionSandboxStep` — the step already gates on `executionTarget != CLOUD`. When `activityTaskQueueOverride` is set, `executionTarget = LOCAL`, so `EnsureSessionSandboxStep` will correctly skip (no double-provisioning).

Same change in `AgentExecutionRecoverHandler` (both its `StartWorkflowStep` and `EnsureSessionSandboxStep`).

### C.3: Wire 5th arg in OSS `create.go`

**File**: `backend/services/stigmer-server/pkg/domain/agentexecution/controller/create.go` (line 575)

```go
// Before (4 args — compilation error or empty string):
dispatch, err := agentexecutiontemporal.ResolveActivityTaskQueue(
    ctx.Context(), s.store, execution.GetSpec().GetSessionId(), s.temporalConfig)

// After (5 args):
dispatch, err := agentexecutiontemporal.ResolveActivityTaskQueue(
    ctx.Context(), s.store, execution.GetSpec().GetSessionId(), s.temporalConfig,
    execution.GetSpec().GetActivityTaskQueue())
```

**Q2 resolved — confirmed arity mismatch**: `ResolveActivityTaskQueue` has 5 params, `create.go` passes 4. This is a compile-time error. The fix is exactly as shown above.

### C.4: Security — strip `activity_task_queue` from external callers

**File**: New pipeline step in `AgentExecutionCreateHandler` (cloud) + equivalent in OSS `create.go`

The `activity_task_queue` field on `AgentExecutionSpec` is internal-only — only the TS runner's `call-agent.ts` should set it when spawning child agents inside a workflow sandbox. External API callers must not be able to route their agent executions to arbitrary task queues.

**Cloud approach**: New step `StripInternalFieldsStep` (or inline in existing `StripRuntimeEnvStep`):
```java
if (!isInternalCaller(context)) {
    spec.clearActivityTaskQueue();
}
```

**Q3 resolved — `isMachineAccount()` is insufficient**: Sandbox tokens produce `isMachineAccount=false` (hardcoded in `RequestCallerIdentityMapper` for PlatformClient path). Must propagate `token_type` claim through the auth chain:
1. `PlatformClientTokenAuthenticationProvider` — read `token_type` from verified JWT
2. `PlatformClientAuthenticationToken` — carry `tokenType` field
3. `RequestCallerIdentityMapper` — map into new `tokenType` field on `RequestCallerIdentity`
4. Strip step checks: `caller.isMachineAccount() || "sandbox".equals(caller.getTokenType()) || "workflow_sandbox".equals(caller.getTokenType())`

**Pattern to follow**: `OrganizationCreateHandler.NormalizeIsPersonal` — inner pipeline step that strips fields for non-system callers.

**OSS approach**: In `create.go`, clear the field if the request does not come from an authenticated runner. This requires caller context propagation in the Go interceptor.

**Alternative (simpler)**: Always strip `activity_task_queue` at the API boundary. Let the TS runner set it via a dedicated internal RPC or a separate field that only the SDK can set. This is more secure but requires a proto change.

---

## Workstream D: Lifecycle Hooks (Cleanup)

**Repo**: stigmer-cloud
**This is the workstream my original plan completely missed.**

### Why Cleanup is Critical

Session sandboxes are cleaned up when the user explicitly deletes the session (`SessionDeleteHandler.DeprovisionSandboxStep`). Workflow sandboxes have no equivalent — workflow executions are fire-and-forget. Without automated cleanup, every workflow execution in cloud mode leaves an orphaned Daytona VM running indefinitely (until Daytona auto-stop at 120min, but the Mongo record persists forever).

### D.1: Cleanup in orchestrator `finally` block (primary path)

**File**: `.../workflowexecution/temporal/workflow/InvokeWorkflowExecutionWorkflowImpl.java`

The orchestrator's `run()` method has a `finally` block in a detached cancellation scope that currently only deletes the ExecutionContext. Add sandbox cleanup:

```java
Workflow.newDetachedCancellationScope(() -> {
    deleteExecutionContextActivity.deleteByExecutionId(executionId);
    deprovisionWorkflowSandboxActivity.deprovision(executionId);  // NEW
}).run();
```

**New activity**: `DeprovisionWorkflowSandboxActivity` — a local activity (runs in the stigmer-service JVM, not in a remote worker) that calls `DaytonaSandboxProvisioner.deprovisionWorkflowSandbox(executionId)`.

**Why local activity**: The orchestrator runs in the stigmer-service JVM, which has direct access to the `DaytonaSandboxProvisioner` bean and the Daytona SDK. A local activity avoids routing through another Temporal queue. The Daytona SDK call (HTTP DELETE) typically completes in 1-5 seconds.

**Local activity timeout**: 30 seconds (generous for an HTTP DELETE).

**Handles**: Success, failure, and cancellation (detached scope runs even after cancel).

**Does NOT handle**: Terminate — Temporal terminate kills the workflow process immediately, no `finally` block runs.

### D.2: Cleanup in `WorkflowExecutionTerminateHandler`

**File**: `.../workflowexecution/request/handler/WorkflowExecutionTerminateHandler.java`

Add a `DeprovisionWorkflowSandboxStep` after the terminate-Temporal step. This handles the case where terminate kills the orchestrator before its `finally` block runs.

```java
// Pipeline order:
// ... existing steps ...
// TerminateTemporalWorkflow
// DeprovisionWorkflowSandboxStep  ← NEW (non-critical, fire-and-forget)
// UpdatePhase(TERMINATED)
// Persist
// Redis
```

**Step implementation**: Direct call to `DaytonaSandboxProvisioner.deprovisionWorkflowSandbox(executionId)`. Non-critical (like `EnsureSessionSandboxStep`).

### D.3: Cleanup in `WorkflowExecutionCancelHandler`

**File**: `.../workflowexecution/request/handler/WorkflowExecutionCancelHandler.java`

The cancel handler sends a Temporal cancel signal. The orchestrator's `finally` block (D.1) should handle cleanup. However, as a safety net, add a `DeprovisionWorkflowSandboxStep` after the cancel completes.

**Note**: There's a race — the orchestrator `finally` and the handler step may both try to deprovision. `deprovisionWorkflowSandbox` must be idempotent (the existing `deprovisionSandbox` already is — it logs a warning if the Daytona sandbox is gone).

### D.4: Cleanup in `WorkflowExecutionDeleteHandler`

**File**: `.../workflowexecution/request/handler/WorkflowExecutionDeleteHandler.java`

Safety net: If a workflow execution is deleted before cleanup ran (unlikely but possible), deprovision the sandbox.

### D.5: Re-provision in `WorkflowExecutionRecoverHandler`

**File**: `.../workflowexecution/request/handler/WorkflowExecutionRecoverHandler.java`

The recover handler resets the Temporal workflow to the last good checkpoint. If the sandbox was deprovisioned (D.1/D.2 ran on the previous failure), the workflow will restart but there's no worker on the `wfexec:{id}` queue. Add `EnsureWorkflowSandboxStep` after the reset, mirroring `AgentExecutionRecoverHandler`.

### D.6: Daytona auto-delete as ultimate safety net

Configure `autoDeleteInterval` for workflow sandboxes (unlike session sandboxes which set -1 to disable).

Suggested value: 1440 minutes (24 hours). If the orchestrator `finally` block AND the handler steps all fail to deprovision, Daytona will auto-delete the sandbox after 24 hours of inactivity.

---

## Workstream E: Tests + Validation

**Depends on**: A + B + C + D

### E.1: Java unit tests (stigmer-cloud)

| Component | Tests |
|-----------|-------|
| `SandboxTokenService.mintForWorkflowExecution` | Token claims, TTL, signing |
| `WorkflowSandboxRepo` | CRUD, upsert idempotency |
| `DaytonaSandboxProvisioner.ensureWorkflowSandbox` | Create, fast path, stale token, stopped→recreate |
| `DaytonaSandboxProvisioner.deprovisionWorkflowSandbox` | Delete, idempotent, Daytona-gone |
| `WorkflowExecutionDispatchService.resolve(execution)` | Global/execution routing, CLOUD/LOCAL target |
| `EnsureWorkflowSandboxStep` | Noop gate, non-cloud gate, provisioning, failure swallowed |
| `DeprovisionWorkflowSandboxStep` | Cleanup, idempotent, failure swallowed |
| `SessionDispatchService.resolve(sessionId, override)` | Override path, LOCAL target, harness preserved |

### E.2: Go unit tests (stigmer)

- Extend `create_test.go` — verify 5th arg is passed correctly

### E.3: Integration tests

1. Create workflow execution with `execution_target=CLOUD`, verify sandbox provisioned on `wfexec:{id}` queue
2. Verify child agent executions reuse parent queue (no separate sandbox)
3. Verify sandbox deprovisioned on workflow completion
4. Verify sandbox deprovisioned on workflow cancel
5. Verify sandbox deprovisioned on workflow terminate
6. Verify sandbox re-provisioned on workflow recover
7. Verify existing session sandbox path unaffected
8. Verify `activity_task_queue` stripped from external API callers

### E.4: Regression validation

- All existing session sandbox tests pass
- All existing workflow execution tests pass
- `make test` in stigmer-cloud (126/126 Java tests)
- `make test-integration` in stigmer (Go integration tests)

---

## Open Questions — RESOLVED

### Q1: Token Validation Scope — RESOLVED (No Blocker)

**Question**: Does the backend auth layer validate the `session_id` claim in sandbox JWTs against the resources being accessed?

**Answer**: **No.** The auth layer does NOT validate `session_id` claims against accessed resources. Sandbox tokens are verified only for signature/issuer/expiry via `PlatformClientTokenAuthenticationProvider` → `StigmerJwtVerifier`. Resource access is enforced separately via OpenFGA on request-derived resource IDs (from proto payload, request headers, URL paths), not from JWT scope claims.

**Evidence**:
- `StigmerJwtVerifier` checks RSA signature, `iss=stigmer`, and `exp` only — does not inspect `session_id` or `token_type`
- `PlatformClientTokenAuthenticationProvider` extracts only `sub` → `identityAccountId` and `platform_client_id` — ignores `session_id`
- `CheckpointerProxyController.authorizeCheckpointAccess()` derives `sessionId` from `threadId` in the request, then runs FGA — never reads the JWT's `session_id` claim
- No auth interceptor, filter, or provider reads or compares `session_id` from the JWT

**Impact on plan**: `mintForWorkflowExecution()` works without auth-layer changes. A `workflow_sandbox` token with `workflow_execution_id` instead of `session_id` will authenticate through the existing path. No parallel validation path needed.

### Q2: OSS create.go Compilation — RESOLVED (Confirmed Bug)

**Question**: Does `create.go` line 575 currently compile?

**Answer**: **No — arity mismatch confirmed.** `ResolveActivityTaskQueue` accepts 5 parameters but `create.go` passes only 4. This is a Go compile-time error.

**Function signature** (`dispatch.go:59`):
```go
func ResolveActivityTaskQueue(ctx context.Context, s store.Store, sessionID string, cfg *Config, activityTaskQueueOverride string) (DispatchResult, error)
```

**Call site** (`create.go:575-576`):
```go
dispatch, err := agentexecutiontemporal.ResolveActivityTaskQueue(
    ctx.Context(), s.store, execution.GetSpec().GetSessionId(), s.temporalConfig)
```

**Missing**: 5th argument `activityTaskQueueOverride`. All other call sites (tests in `dispatch_test.go`) pass 5 arguments correctly.

**Fix** (Workstream C.3): Add `execution.GetSpec().GetActivityTaskQueue()` as the 5th argument. The proto field exists (`AgentExecutionSpec` field 11, exposed as `GetActivityTaskQueue()` in generated Go stubs).

### Q3: Internal Caller Detection — RESOLVED (Plan Assumption Incorrect)

**Question**: Can we reliably distinguish internal callers (TS runner via sandbox token) from external callers (user via Auth0 JWT)?

**Answer**: **`isMachineAccount()` alone is insufficient.** Sandbox tokens produce `isMachineAccount=false` because they authenticate via `PlatformClientTokenAuthenticationProvider`, which hardcodes `isMachineAccount(false)` for all Stigmer-signed JWTs. Machine accounts are only Auth0 client-credentials tokens with `@clients` suffix in the IDP ID.

**Key finding**: `RequestCallerIdentity` has no `tokenType` field, and `PlatformClientTokenAuthenticationProvider` does not read the `token_type` JWT claim. There is no existing way to distinguish sandbox-token callers from PlatformClient user-token callers.

**Recommended approach** (Option A from investigation — cleanest):
1. `PlatformClientTokenAuthenticationProvider` — read `token_type` claim from verified JWT
2. `PlatformClientAuthenticationToken` — carry `tokenType` field
3. `RequestCallerIdentityMapper` — map `tokenType` into a new field on `RequestCallerIdentity`
4. New `StripInternalFieldsStep` in agent create/recover handlers:
```java
boolean isInternalCaller = caller.isMachineAccount()
    || "sandbox".equals(caller.getTokenType())
    || "workflow_sandbox".equals(caller.getTokenType());
if (!isInternalCaller && !spec.getActivityTaskQueue().isEmpty()) {
    spec = spec.toBuilder().clearActivityTaskQueue().build();
}
```

**Existing pattern to follow**: `OrganizationCreateHandler.NormalizeIsPersonal` — inner `@Component` pipeline step that checks `context.getCaller().isMachineAccount() || context.getCaller().isImpersonated()` and strips fields for non-system callers.

**Impact on plan**: Workstream C scope is slightly larger — needs `tokenType` propagation through the auth chain (3 files in `api-authentication` lib) plus the strip step. Still ~1 session.

---

## Key Files Reference

### stigmer-cloud — To Create
| File | Purpose |
|------|---------|
| `.../sandbox/WorkflowSandboxRepo.java` | Mongo repo for `workflow_sandboxes` collection |
| `.../sandbox/WorkflowSandbox.java` | Record type for workflow sandbox entities |
| `.../workflowexecution/temporal/workflow/DeprovisionWorkflowSandboxActivity.java` | Local activity for orchestrator cleanup |

### stigmer-cloud — To Modify
| File | Purpose |
|------|---------|
| `.../sandbox/SandboxTokenService.java` | Add `mintForWorkflowExecution` |
| `.../sandbox/DaytonaSandboxProvisioner.java` | Add `ensureWorkflowSandbox` + `deprovisionWorkflowSandbox` |
| `.../workflowexecution/temporal/WorkflowExecutionTemporalConfig.java` | Add routing + target config |
| `.../workflowexecution/temporal/dispatch/WorkflowExecutionDispatchService.java` | Add routing logic |
| `.../workflowexecution/temporal/dispatch/WorkflowDispatchResult.java` | Add executionTarget field |
| `.../workflowexecution/request/handler/WorkflowExecutionCreateHandler.java` | Add EnsureWorkflowSandboxStep, update StartWorkflowStep |
| `.../workflowexecution/request/handler/WorkflowExecutionTerminateHandler.java` | Add DeprovisionWorkflowSandboxStep |
| `.../workflowexecution/request/handler/WorkflowExecutionCancelHandler.java` | Add DeprovisionWorkflowSandboxStep |
| `.../workflowexecution/request/handler/WorkflowExecutionRecoverHandler.java` | Add EnsureWorkflowSandboxStep |
| `.../workflowexecution/request/handler/WorkflowExecutionDeleteHandler.java` | Add DeprovisionWorkflowSandboxStep |
| `.../workflowexecution/temporal/workflow/InvokeWorkflowExecutionWorkflowImpl.java` | Add cleanup in finally block |
| `.../workflowexecution/temporal/WorkflowExecutionTemporalWorkerConfig.java` | Register new activity |
| `.../agentexecution/temporal/dispatch/SessionDispatchService.java` | Add override overload |
| `.../agentexecution/request/handler/AgentExecutionCreateHandler.java` | Wire activity_task_queue |
| `.../agentexecution/request/handler/AgentExecutionRecoverHandler.java` | Wire activity_task_queue |

### stigmer (OSS) — To Modify
| File | Purpose |
|------|---------|
| `backend/services/stigmer-server/pkg/domain/agentexecution/controller/create.go` | Wire 5th arg |

### Reference Only (Already Complete)
| File | Purpose |
|------|---------|
| `.../workflowexecution/temporal/dispatch.go` (OSS) | Routing logic to mirror |
| `.../workflowexecution/temporal/config.go` (OSS) | Config pattern to mirror |
| `backend/services/runner/src/workflows/engine-core.ts` | TS propagation (done) |
| `backend/services/runner/src/activities/call-agent.ts` | Agent queue override (done) |
| `_changelog/2026-05/2026-05-21-180841-workflow-sandbox-affinity-architecture.md` | OSS foundation doc |

## Success Criteria

1. Workflow executions with `execution_target=CLOUD` + routing=execution provision a single `wfexec:{id}` Daytona sandbox
2. Child agent executions spawned by `call:agent` tasks reuse the parent workflow sandbox (`ExecutionTarget=LOCAL`, no separate provision)
3. Sandbox is automatically deprovisioned when workflow reaches any terminal phase (complete, failed, cancelled, terminated)
4. Sandbox is re-provisioned on workflow recover (Temporal reset)
5. `activity_task_queue` is stripped from external API callers
6. Existing session sandbox path is completely unaffected
7. OSS defaults (`global` routing, `local` target) remain unchanged
8. No orphaned Daytona VMs (primary cleanup + safety nets + Daytona auto-delete)
