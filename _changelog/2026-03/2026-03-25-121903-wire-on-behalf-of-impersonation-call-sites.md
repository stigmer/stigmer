# Wire On-Behalf-Of Impersonation into All createAsSystem Call Sites

**Date**: March 25, 2026

## Summary

Converted all 7 `createAsSystem` call sites in stigmer-service domain handlers to use `createOnBehalfOf`, ensuring that system-created resources (ExecutionContext, AgentInstance, WorkflowInstance) are FGA-owned by the actual invoking user rather than the machine account. Also simplified a redundant FGA ownership relation in `agent_execution.fga`.

## Problem Statement

When backend handlers auto-created resources (default instances, execution contexts) as part of parent operations, they used `createAsSystem` which authenticated as the machine account. This meant:

### Pain Points

- ExecutionContext resources (containing decrypted secrets) were owned by the machine account, not the user who triggered the execution
- Auto-created AgentInstance and WorkflowInstance defaults were owned by the machine account, making them invisible to user-level FGA queries
- The `agent_execution.fga` model had a redundant `operator from session` clause in its `owner` relation, adding unnecessary complexity to the authorization model

## Solution

Leveraged the on-behalf-of gRPC impersonation infrastructure (built in project `20260325.02`) to attribute all system-created resources to the invoking user. Each `createAsSystem(resource)` call was replaced with `createOnBehalfOf(resource, context.getCaller().getIdentityAccountId())`, using the caller identity already available on every pipeline step's `CreateContextV2`.

For WorkflowInstance (which lacked the OBO method), added `createOnBehalfOf` to both the interface and implementation following the established pattern from AgentInstanceGrpcRepoImpl.

## Implementation Details

### FGA Model Cleanup (T07)

- `agent_execution.fga`: Changed `owner: owner from session or operator from session` to `owner: owner from session`
- Safe because `session.owner` is defined as `[identity_account] or operator`, so `owner from session` already transitively includes all operators

### ExecutionContext OBO (T01) — 2 call sites

- `agentexecution/.../CreateExecutionContextStep.java`: `createAsSystem` → `createOnBehalfOf`
- `workflowexecution/.../CreateExecutionContextStep.java`: Same conversion
- No repo-level changes needed (interface and impl already had `createOnBehalfOf`)

### AgentInstance OBO (T02) — 3 call sites

- `AgentCreateHandler.CreateDefaultInstance`: Default instance created during agent creation
- `AgentExecutionCreateHandler.CreateDefaultInstanceIfNeededStep`: Fallback instance creation during execution
- `SessionCreateHandler.ResolveDefaultAgentInstanceStep`: Instance creation when resolving platform default agent

### WorkflowInstance OBO (T03) — 2 repo files + 2 call sites

- `WorkflowInstanceGrpcRepo.java`: Added `createOnBehalfOf` interface method
- `WorkflowInstanceGrpcRepoImpl.java`: Added `ImpersonatedChannelFactory` injection and `createOnBehalfOf` implementation
- `WorkflowCreateHandler.CreateDefaultInstance`: Default instance during workflow creation
- `WorkflowExecutionCreateHandler.CreateDefaultInstanceIfNeededStep`: Fallback instance during execution

### Javadoc Cleanup

- Updated 3 stale Javadoc references that still mentioned `createAsSystem` in method descriptions

## Benefits

- **Correct FGA ownership**: All system-created resources are now owned by the user who triggered the parent operation
- **Secret access control**: ExecutionContext (which holds decrypted secrets) is owned by the actual user, enabling future FGA-based access control
- **Simpler FGA model**: Removed redundant relation clause from `agent_execution.fga`
- **Consistent pattern**: All downstream gRPC repos now follow the same `createAsSystem` / `createOnBehalfOf` dual-method pattern

## Impact

- **11 files changed** across stigmer-cloud (58 insertions, 16 deletions)
- **All domain handlers** that auto-create resources now attribute ownership to the invoking user
- **Zero remaining** `createAsSystem` invocations in the domain layer
- **No behavioral changes** for end users — resources are created identically, only the FGA ownership attribution changes

## Related Work

- Prerequisite: [On-Behalf-Of gRPC Impersonation Infrastructure](2026-03-25-113851-on-behalf-of-grpc-impersonation-infrastructure.md) — built `ImpersonatedChannelFactory`, `OnBehalfOfClientInterceptor`, server-side identity override, and `can_impersonate` FGA permission
- Prerequisite: [Personal Org Auto-Creation](2026-03-25-120817-personal-org-auto-creation.md) — established the `feat/auto-create-org` branch
- Future: T04-T06 (Temporal workflow inputs + runner OBO headers) will extend impersonation to the agent-runner and workflow-runner
- Future: T08 (execution_context FGA type) will add FGA protection to the most sensitive resource in the system

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~30 minutes)
