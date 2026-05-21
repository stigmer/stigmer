# Cloud Sandbox Provisioning for EXECUTION_TARGET_CLOUD Sessions

**Date**: May 21, 2026

## Summary

Implemented cloud sandbox provisioning so that sessions with `execution_target=CLOUD` get a Daytona sandbox with a Temporal worker before agent activities dispatch. Re-added the Daytona SDK and created a full sandbox lifecycle manager (create, restart, restore, recreate) that runs as a pipeline step in the execution create handler — matching the fire-and-forget pattern from the deleted Runner architecture.

## Problem Statement

After the Runner API deletion (T01-T05) and the execution_target wiring (Session 9), the `EXECUTION_TARGET_CLOUD` path was a no-op. Sessions could be marked as CLOUD, the dispatch would resolve the correct per-session queue, but no sandbox was provisioned — activities were scheduled on a `session:{id}` queue with no worker, eventually hitting the 5-minute `ScheduleToStartTimeout` with zero diagnostic information.

### Pain Points

- Cloud-mode sessions had no backing compute — the sandbox provisioning was deleted with the Runner domain
- The Daytona SDK dependency was removed from MODULE.bazel in T05
- No mechanism to create, restart (after auto-stop), or restore (after archive) sandboxes on follow-up executions

## Solution

A new `domain/agentic/sandbox/` package in stigmer-cloud with a strategy-based `SandboxProvisioner` interface, a `DaytonaSandboxProvisioner` implementation that reuses the core logic from the deleted `DaytonaSandboxRunnerLauncher`, and pipeline steps in both `AgentExecutionCreateHandler` and `AgentExecutionRecoverHandler` that provision sandboxes fire-and-forget when `execution_target=CLOUD`.

## Implementation Details

### Sandbox Domain Package (7 classes)
- `SessionSandbox` — record entity with lifecycle status enum (PROVISIONING, RUNNING, STOPPED, ARCHIVED, FAILED)
- `SessionSandboxRepo` — MongoDB repository (collection: `session_sandboxes`, unique index on `session_id`)
- `SandboxProvisioner` — strategy interface: `ensureSandbox()` + `deprovisionSandbox()`
- `DaytonaSandboxProvisioner` — Daytona implementation with full lifecycle handling: checks MongoDB for existing record, verifies state against Daytona API (getState()), creates/restarts/restores/recreates as needed
- `NoopSandboxProvisioner` — for local dev and OSS deployments
- `SandboxProvisionerConfig` — Spring `@ConfigurationProperties` with Daytona client factory
- `SandboxEnvironment` — value object carrying session coordinates, endpoints, and user JWT

### Pipeline Integration
- `EnsureSessionSandboxStep` in `AgentExecutionCreateHandler` — runs after `StartWorkflowStep`, checks execution_target from dispatch, captures JWT via `UserTokenHolder.get()`, calls `sandboxProvisioner.ensureSandbox()`. Non-critical, fire-and-forget.
- Same step in `AgentExecutionRecoverHandler` for recovered executions
- `DeprovisionSandboxStep` in `SessionDeleteHandler` — best-effort sandbox cleanup on session deletion

### Key Adaptation: Pipeline Step, Not Temporal Activity
The original plan placed sandbox provisioning as a Temporal activity inside the workflow. This was refactored to a pipeline step because the Temporal activity context has no access to the gRPC request's `UserTokenHolder` — putting the JWT in the Temporal workflow input would store secrets in durable workflow history. The pipeline step runs in the gRPC request thread where `UserTokenHolder.get()` is naturally available, matching the old `ProvisionInfrastructureStep` pattern exactly.

### Go Forward-Compatibility
Added `ExecutionTarget int32` to the Go `InvokeAgentExecutionWorkflowInput` struct. The OSS workflow ignores it — sandbox provisioning is cloud-only.

## Benefits

- **Cloud path works**: `execution_target=CLOUD` sessions now get a backing sandbox with a Temporal worker
- **Full lifecycle**: Handles all Daytona states — not just creation, but restart (after idle auto-stop), restore (after archive), and recreation (after deletion)
- **Same pattern as before**: Pipeline step with `UserTokenHolder.get()` for JWT — no secrets in Temporal history
- **Idempotent**: Every execution hits the same `ensureSandbox()` path — first execution creates, follow-ups verify or restart
- **Clean separation**: Sandbox provisioning is cloud-only. OSS repo gets only a harmless forward-compat field.

## Impact

| Component | Change |
|-----------|--------|
| stigmer-cloud MODULE.bazel | Re-added `io.daytona:sdk:0.168.0` |
| stigmer-cloud sandbox domain | New package: 7 classes, ~500 lines |
| AgentExecutionCreateHandler | New `EnsureSessionSandboxStep` pipeline step |
| AgentExecutionRecoverHandler | Same pipeline step for recovered executions |
| SessionDeleteHandler | New `DeprovisionSandboxStep` for cleanup |
| Go workflow_input.go | Added `ExecutionTarget` field (forward-compat) |
| Tests | 11 Java + 3 Go = 14 new tests |

## Related Work

- T01-T05: Runner API deletion (prerequisite — completed in earlier sessions)
- Session 9: execution_target wired through session creation flow
- Session 7 (T06c): Desktop embedded runner with execution target routing
- Future: TokenExchangeService for short-lived sandbox-scoped tokens

---

**Status**: Production Ready (with noop default; Daytona activation requires config)
**Timeline**: ~1 hour
