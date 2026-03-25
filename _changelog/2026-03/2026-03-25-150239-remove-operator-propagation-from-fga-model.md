# Remove Operator Propagation from FGA Model

**Date**: March 25, 2026

## Summary

Removed the transitive `operator` propagation chain from the entire FGA authorization model, replacing it with 4 explicit platform-level permissions checked directly against `platform:stigmer`. This eliminates unnecessary tuple creation on every organization and identity account creation, removes boilerplate from all 16 FGA type definitions, and cleanly separates the `operator` role from specific permissions in the proto enum.

## Problem Statement

The `operator` role propagated through a 4-level transitive chain: `platform` → `organization` → every resource type. Every FGA type definition carried `define operator: operator from organization` boilerplate, and every org/identity_account creation wrote extra platform-link tuples (`resource#platform@platform:stigmer`) solely to enable this propagation.

### Pain Points

- **Tuple bloat**: Every org and identity account creation wrote an extra platform-link FGA tuple that served no purpose beyond operator propagation
- **Model noise**: All 16 FGA type definitions carried `operator` relation boilerplate (`define operator: operator from organization`, `or operator` unions)
- **Role/permission conflation**: The `operator` and `platform` values in `ApiResourceIamPermission` enum acted as roles masquerading as permissions, making authorization annotations misleading
- **Unnecessary complexity**: The `createPlatformLink` RPC, its handler, and the `AUTHORIZATION_SCOPE_TYPE_PLATFORM` code path existed solely to support this propagation chain
- **Redundancy with `can_impersonate`**: Once on-behalf-of impersonation was in place, transitive operator access to every resource became redundant

## Solution

Replace the transitive propagation chain with 4 explicit platform-level permissions that map to real trust boundaries. Each permission is checked directly against `platform:stigmer` at the RPC level — no transitive FGA relations needed.

**New platform permissions:**
- `can_impersonate` — gates the `x-on-behalf-of` gRPC header
- `can_bootstrap_iam` — gates `bootstrapPolicy` and `cleanupResourcePolicies` RPCs
- `can_manage_identity_accounts` — gates admin operations on identity accounts
- `can_update_execution_status` — gates agent/workflow execution status updates from runners

## Implementation Details

### Phase 1: FGA Model Simplification (16 files)

- **`platform.fga`**: Removed `organization` and `identity_account` collection relations. Added `can_bootstrap_iam`, `can_manage_identity_accounts`, `can_update_execution_status` — all deriving from `operator`.
- **`organization.fga`**: Removed `define platform: [platform]`, `define operator: operator from platform`, and `or operator` from owner. Owner is now direct assignment only.
- **`identity_account.fga`**: Same removals. `can_delete` and `can_grant_access` now derive from `owner` (self) instead of `operator`.
- **11 org-scoped resource types** (`agent`, `session`, `skill`, `workflow`, `environment`, `mcp_server`, `project`, `identity_provider`, `iam_policy`, `agent_instance`, `workflow_instance`): Removed `operator` relation and all `or operator` unions.
- **`agent_execution.fga` / `workflow_execution.fga`**: Removed `operator` and `can_update_status` relations entirely.
- **`api_key.fga`**: Removed `operator from owner` and all `or operator` unions.

### Phase 2: Proto Changes (5 files)

- **`iam_permission.proto`**: Deleted `operator = 5`, `platform = 6`, `can_update_status = 28` with `reserved` markers. Added `can_bootstrap_iam = 29`, `can_manage_identity_accounts = 30`, `can_update_execution_status = 31`.
- **`iam/iampolicy/v1/command.proto`**: Deleted `createPlatformLink` RPC entirely. Changed `bootstrapPolicy` and `cleanupResourcePolicies` from `permission = operator` to `permission = can_bootstrap_iam`.
- **`agentexecution/v1/command.proto` / `workflowexecution/v1/command.proto`**: Changed `updateStatus` RPCs from resource-level `can_update_status` to platform-level `can_update_execution_status` on `platform:stigmer`.
- **`api_resource_kind.proto`**: Changed `organization` and `identity_account` from `AUTHORIZATION_SCOPE_TYPE_PLATFORM` to `AUTHORIZATION_SCOPE_TYPE_OWNER_ONLY`.

### Phase 3: Java Backend (21 files modified, 1 deleted)

- **Handlers**: Updated `IdentityAccountGetActorInfoHandler` and `SimulateSignupWebhookHandler` to use `can_manage_identity_accounts` instead of `operator`.
- **`IamPolicyCreationService`**: Deleted `createPlatformLink()` method and `AUTHORIZATION_SCOPE_TYPE_PLATFORM` switch case.
- **`IamPolicyGrpcRepo` / `IamPolicyGrpcRepoImpl`**: Removed `createPlatformLink()` interface method and implementation.
- **`IamPolicyCreatePlatformLinkHandler.java`**: Deleted entirely (313 lines).
- **Bootstrap migration**: Removed platform-link tuple from `buildOperatorPolicies()`.
- **`CreateAuthorizationTuplesStepV2`**: Removed dead `AUTHORIZATION_SCOPE_TYPE_PLATFORM` case.
- **Test file**: Updated `IamPolicyCreationServiceTest` — removed all platform-link assertions.
- **Javadoc cleanup**: Updated ~13 handler files to replace "platform operator" references with specific permission names.

## Benefits

- **Simpler FGA model**: 16 type definitions are cleaner — no `operator` boilerplate
- **Fewer tuples**: No more platform-link tuples on org/identity_account creation (2 fewer writes per resource)
- **Clearer authorization**: RPC annotations now reference specific permissions (`can_bootstrap_iam`) instead of a generic role (`operator`)
- **Less code**: Deleted `IamPolicyCreatePlatformLinkHandler` (313 lines), `createPlatformLink()` method, and PLATFORM scope handling
- **Better auditability**: Each platform-level capability is a distinct FGA relation, making audit logs meaningful
- **Future-proof**: When operator role eventually splits (e.g., read-only admin vs full admin), each permission can be reassigned independently

## Impact

- **FGA model**: All 16 type definitions simplified
- **Proto APIs**: 5 files updated, 1 RPC deleted, 3 enum values reserved
- **Java backend**: 21 files modified, 1 file deleted across handlers, services, repos, tests, and pipeline steps
- **Data**: Existing platform-link tuples in FGA store become harmless dead data (follow-up cleanup migration recommended)

## Related Work

- On-behalf-of impersonation (`can_impersonate`) — the feature that made operator propagation redundant
- Agent runner OBO channel refactor — uses `can_impersonate` for cross-user operations

---

**Status**: ✅ Production Ready
**Timeline**: Single session
