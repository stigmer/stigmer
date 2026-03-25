# Wire OBO Impersonation into Agent & Workflow Runners + FGA Hardening

**Date**: March 25, 2026

## Summary

Completed the full on-behalf-of (OBO) impersonation wiring across both the Python agent-runner and Go workflow-runner, ensuring all downstream gRPC calls execute as the invoking user rather than the machine account. Hardened FGA authorization with a new `can_update_status` operator-only permission, derived authorization for ephemeral ExecutionContext resources, and security-critical pipeline reordering in execution handlers.

## Problem Statement

After the OBO infrastructure was built (interceptors, `ImpersonatedChannelFactory`, `createOnBehalfOf` repo methods) and the invoker identity was threaded through Temporal workflow inputs, the runners themselves still operated entirely as the machine account. Every gRPC call from `execute_graphton.py` (Python) and `execute_workflow_activity.go` (Go) used the system API key with no user identity — meaning FGA checks on downstream resources saw the machine account, not the actual user who triggered the execution.

### Pain Points

- All runner gRPC reads (Agent, Session, ExecutionContext, Skill, etc.) executed as the machine account, bypassing per-user FGA visibility checks
- `updateStatus` had no permission distinction from regular edits — any user with `can_edit` could mutate execution status
- ExecutionContext (holding decrypted secrets) had zero FGA-level authorization — relied solely on transport-level auth
- Go task builder's `CallAgentActivity` was making unauthenticated gRPC calls (missing both auth and OBO headers)
- Creation pipelines persisted executions before FGA tuples existed, creating a window where authorization was incomplete

## Solution

Implemented a comprehensive multi-layer approach:

1. **Dual-channel pattern**: System channel for operator-only operations (status updates), OBO channel for user-scoped reads
2. **`can_update_status` FGA permission**: New operator-only permission for status mutation, separated from `can_edit`
3. **Derived authorization for ExecutionContext**: Handler-level auth checks `can_view` on parent execution instead of a dedicated FGA model
4. **Pipeline reordering**: Create FGA tuples before ExecutionContext, clear secrets before persist

## Implementation Details

### Python Agent Runner (OBO Wiring)

Created `OnBehalfOfInterceptor` as a new gRPC client interceptor that injects the `x-on-behalf-of` header alongside the existing `authorization` header. Extended `ChannelProvider` with dual-channel support:

- `channel` — system channel (API key only) for operator operations
- `obo_channel` — impersonated channel (API key + OBO header) for user-scoped reads

In `execute_graphton.py`, all read-focused clients (Session, Agent, AgentInstance, ExecutionContext, Environment, Skill, McpServer) use the OBO channel. The `execution_client` remains on the system channel for `updateStatus` calls.

In `generate_session_subject.py`, added `invoker_identity_account_id` parameter and updated the corresponding Java activity interface to pass the identity through.

### Go Workflow Runner (OBO Wiring)

Created `WithOnBehalfOf` context helper in `pkg/grpc_client/on_behalf_of.go` that appends the OBO metadata to outgoing gRPC context.

In `execute_workflow_activity.go`, created `oboCtx` for all read operations (WorkflowInstance, Workflow, ExecutionContext) while `updateStatus` calls use the plain system context.

Discovered and fixed missing authentication headers in `task_builder_call_agent_activities.go` — the `initGrpcConnection` created raw connections without interceptors. Introduced `buildAuthenticatedContext` helper that injects both `authorization` and `x-on-behalf-of` headers. Threaded `InvokerIdentityAccountID` through `TemporalWorkflowInput` into the Zigflow workflow state (`__stigmer_invoker_identity_account`), making it available to all task builders.

### FGA Authorization Hardening

- Added `operator` relation (from `session`) and `can_update_status: operator` permission to `agent_execution.fga`
- Added `can_update_status: operator` permission to `workflow_execution.fga`
- Changed `updateStatus` RPCs from `can_edit` to `can_update_status` in both execution command protos
- Added `can_update_status = 28` to the `ApiResourceIamPermission` enum

### ExecutionContext Derived Authorization

Architectural decision: ExecutionContext is ephemeral (1:1 with parent execution, created and deleted within execution lifecycle). A dedicated FGA model would be over-engineering with tuple creation/deletion overhead for no practical benefit.

Solution:
- Set `is_skip_authorization=true` on all ExecutionContext RPCs (both command and query protos)
- Rewrote `ExecutionContextGetByExecutionIdHandler.Authorize` to check `can_view` on the parent `agent_execution` or `workflow_execution` (tries agent first, falls back to workflow)
- Other ExecutionContext RPCs (create/delete) are system-only internal operations

### Pipeline Reordering

Reordered both `AgentExecutionCreateHandler` and `WorkflowExecutionCreateHandler` pipelines from:
`persist → createAuthorizationTuples → createExecutionContext`

To:
`createAuthorizationTuples → createExecutionContext → persist`

This ensures FGA tuples exist before any resource that depends on them for derived authorization, and `runtime_env` (containing secrets) is cleared before the execution is persisted to MongoDB.

## Benefits

- **User attribution**: All runner gRPC reads now execute as the actual user, enabling per-user FGA visibility checks
- **Least privilege**: `updateStatus` restricted to operators only via dedicated FGA permission
- **Defense in depth**: ExecutionContext access requires `can_view` on parent execution, not just transport-level auth
- **Security-by-default pipeline**: Secrets cleared before persistence, FGA tuples created before dependent resources
- **Latent bug fix**: Go task builder gRPC calls now properly authenticated (were previously unauthenticated)

## Impact

- **Agent executions**: All 8+ gRPC clients in `execute_graphton.py` now carry user identity for FGA checks
- **Workflow executions**: All read clients in `execute_workflow_activity.go` carry user identity
- **Child agent calls**: `CallAgentActivity` in Zigflow now properly authenticated with OBO headers
- **Status mutations**: Only operators can update execution status (new `can_update_status` permission)
- **ExecutionContext access**: Protected by derived authorization from parent execution

## Related Work

- Builds on `on-behalf-of-grpc-impersonation-infrastructure` (2026-03-25) — the interceptor and infrastructure layer
- Builds on `wire-on-behalf-of-impersonation-call-sites` (2026-03-25) — `createOnBehalfOf` in stigmer-service handlers
- Builds on `thread-invoker-identity-through-temporal-workflow-inputs` (2026-03-25) — Temporal input threading
- Relates to `fga-personal-resources-auth-model` (2026-03-19) — the broader FGA authorization model

---

**Status**: ✅ Production Ready (pending end-to-end testing)
**Timeline**: 1 session (~3 hours)
