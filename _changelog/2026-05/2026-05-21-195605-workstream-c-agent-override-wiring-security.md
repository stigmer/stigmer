# Workstream C: Agent Override Wiring + Security

**Date**: May 21, 2026

## Summary

Implemented the cloud-side agent override wiring and security stripping for workflow sandbox affinity. Child agent executions spawned inside a workflow sandbox now correctly route to the parent workflow's task queue, and external API callers are prevented from abusing the `activity_task_queue` field to route executions to arbitrary queues.

## Problem Statement

The OSS foundation (proto fields, Go dispatch, TS propagation) for sandbox affinity was complete, but the cloud service (Java/Spring Boot) had no support for the `activity_task_queue` override on AgentExecutionSpec. Additionally, the OSS `create.go` had a compile-time arity mismatch, and no security mechanism existed to prevent external callers from setting the routing field.

### Pain Points

- Cloud `SessionDispatchService` had no override path — child agents always provisioned separate sandboxes
- OSS `create.go` failed to compile (4 args passed to 5-param function)
- No defense-in-depth: any API caller could set `activity_task_queue` to route executions to arbitrary queues
- No way to distinguish sandbox runner callers from regular PlatformClient users in the auth chain

## Solution

Six-layer implementation across the auth chain, dispatch service, and handler pipelines:

1. **Token type propagation**: Extended the PlatformClient auth chain to propagate the `token_type` JWT claim through `PlatformClientAuthenticationToken` → `RequestCallerIdentityMapper` → `RequestCallerIdentity`
2. **Dispatch override method**: Added `SessionDispatchService.resolve(sessionId, activityTaskQueueOverride)` that routes to the override queue with `ExecutionTarget=LOCAL`
3. **Security strip step**: Added `StripActivityTaskQueueStep` in the create handler pipeline that strips the field from non-internal callers
4. **Handler wiring**: Updated both `AgentExecutionCreateHandler` and `AgentExecutionRecoverHandler` to pass the override to dispatch
5. **OSS compile fix**: Added the missing 5th argument to `ResolveActivityTaskQueue` in `create.go`

## Implementation Details

### Auth Chain (api-authentication library, 4 files)
- `PlatformClientAuthenticationToken` — new `tokenType` field + backward-compatible 3-arg constructor
- `PlatformClientTokenAuthenticationProvider` — extracts `token_type` claim from verified JWT
- `RequestCallerIdentity` — new `tokenType` field (Lombok `@Builder`, additive)
- `RequestCallerIdentityMapper` — propagates `tokenType` in PlatformClient branch

### Dispatch (stigmer-service)
- `SessionDispatchService.resolve(sessionId, override)` — mirrors Go `dispatch.go:59-82`; returns override queue + LOCAL target + session harness

### Security (stigmer-service)
- `StripActivityTaskQueueStep` inner class in `AgentExecutionCreateHandler` — caller-type-gated field normalization following `NormalizeIsPersonal` pattern
- Only in create handler (not recover) — recover reads trusted persisted state

### Handler Wiring (stigmer-service)
- `AgentExecutionCreateHandler.StartWorkflowStep` + `EnsureSessionSandboxStep` — pass override
- `AgentExecutionRecoverHandler.StartWorkflowStep` + `EnsureSessionSandboxStep` — pass override

### OSS Fix (stigmer-server)
- `create.go` line 576 — added `execution.GetSpec().GetActivityTaskQueue()` as 5th arg

## Benefits

- **Sandbox sharing works end-to-end**: Child agent executions routed to parent workflow's queue
- **No double-provisioning**: Override returns LOCAL target, skipping `EnsureSessionSandboxStep`
- **Security hardened**: External callers cannot route to arbitrary queues
- **Backward compatible**: 3-arg constructor preserved, Lombok builder additive, new method is overload
- **Auth chain reusable**: `tokenType` on `RequestCallerIdentity` available for future security checks

## Impact

| Component | Change |
|-----------|--------|
| `api-authentication` library | 4 production files + 1 test file (additive, backward-compatible) |
| `SessionDispatchService` | New overloaded method (existing callers unaffected) |
| `AgentExecutionCreateHandler` | New strip step + override wiring in 2 steps |
| `AgentExecutionRecoverHandler` | Override wiring in 2 steps (no strip step needed) |
| OSS `create.go` | 1-line fix (5th argument) |

## Related Work

- [Workflow Sandbox Affinity Architecture](2026-05-21-180841-workflow-sandbox-affinity-architecture.md) — OSS foundation (proto, Go dispatch, TS propagation)
- [Workstream B: Orchestrator Rewrite](2026-05-21-174307-workstream-b-orchestrator-rewrite-pause-resume.md) — prerequisite
- Plan: `_projects/2026-05/20260521.02.cloud-workflow-sandbox-affinity/tasks/T01_0_plan.md` (Workstream C section)

---

**Status**: Complete (builds pass, auth library 5/5 tests pass)
**Timeline**: Single session (~30 minutes)
