# Task T01: IAM Role/Permission Separation — Analysis and Implementation Plan

**Created**: 2026-04-05
**Status**: Planning (pending review)

## Problem Statement

The current `ApiResourceIamPermission` enum in `apis/ai/stigmer/iam/iampolicy/v1/rpcauthorization/iam_permission.proto` conflates three fundamentally different concepts:

1. **Roles** (assignable to principals by users): `owner` (10), `member` (11), `viewer` (26) — and `admin` is **missing** despite existing in the FGA model
2. **Permissions** (checked by the authorization interceptor): `can_view`, `can_edit`, `can_delete`, `can_create_agent`, `can_create_idp`, etc.
3. **Structural relations** (internal FGA wiring): `organization` (13), `identity_account` (12), `session` (14), `agent` (15)

In the FGA model, the distinction is clear:
- `define owner: [identity_account]` — **role** (directly assignable)
- `define can_view: member` — **permission** (computed from roles)
- `define organization: [organization]` — **structural relation** (parent link)

Mixing these in one enum makes it impossible to:
- Build a web app role selector that reads "which roles can be granted on this resource" from proto metadata
- Validate IAM policy creation ("you granted `can_view` but that's a permission, not a role")
- Generate clear documentation ("roles are assigned, permissions are checked")

## Objective

Split the enum into separate `IamRole` and `IamPermission` enums. Remove structural relations from both. Add `admin` as a first-class role. Enrich `AuthorizationConfig` with `grantable_roles` per `ApiResourceKind`.

## Current State Analysis

### Files that define the enum

- `apis/ai/stigmer/iam/iampolicy/v1/rpcauthorization/iam_permission.proto` — the monolithic enum (31 values)

### Files that consume the enum

- `apis/ai/stigmer/iam/iampolicy/v1/rpcauthorization/io.proto` — `RpcAuthorizationConfig.permission` field (only ever set to `can_*` values)
- All `command.proto` and `query.proto` files across every resource — method options like `(config).permission = can_edit`
- Backend Java code for FGA tuple creation — uses role and structural relation values

### Files that need new metadata

- `apis/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config.proto` — add `grantable_roles`
- `apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto` — declare roles per kind

### Related: `IamPolicySpec.relation`

Currently in `apis/ai/stigmer/iam/iampolicy/v1/spec.proto`, `relation` is a `string` field. It should be validated against `IamRole` values for the target resource kind. This is a follow-up validation change, not a proto type change.

## Proposed Changes

### Phase 1: Create new `IamRole` enum

**New file**: `apis/ai/stigmer/iam/iampolicy/v1/rpcauthorization/iam_role.proto`

```protobuf
enum IamRole {
  iam_role_unspecified = 0;
  owner = 1;
  admin = 2;
  member = 3;
  viewer = 4;
}
```

This is a small, stable enum. Roles are human-assigned and rarely change.

### Phase 2: Rename and clean up `IamPermission`

Rename `ApiResourceIamPermission` → `IamPermission` in the same file (or new file).

**Remove from the enum:**
- Roles: `owner` (10), `member` (11), `viewer` (26) → moved to `IamRole`
- Structural relations: `organization` (13), `identity_account` (12), `session` (14), `agent` (15) → become string constants in backend code
- `create` (1) → ambiguous, review usage

**Keep (renumber or reserve old slots):**
- All `can_*` permissions: `can_delete` (2), `can_view` (3), `can_edit` (4), `can_grant_access` (8), `can_view_access` (9), etc.
- `login_to_back_office` (7)

**Reserve removed field numbers** to prevent accidental reuse.

### Phase 3: Add `grantable_roles` to `AuthorizationConfig`

In `apis/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config.proto`:

```protobuf
import "ai/stigmer/iam/iampolicy/v1/rpcauthorization/iam_role.proto";

message AuthorizationConfig {
  // ... existing fields (1-6) ...
  
  // Roles that can be granted on this resource kind via IAM policies.
  // Empty means no user-grantable roles.
  repeated ai.stigmer.iam.iampolicy.v1.rpcauthorization.IamRole grantable_roles = 7;
}
```

### Phase 4: Declare `grantable_roles` per `ApiResourceKind`

In `api_resource_kind.proto`, update each kind's metadata. Derived from the FGA model:

| Resource Kind | Grantable Roles | Source (FGA) |
|---|---|---|
| `organization` | `owner`, `admin`, `member` | `organization.fga`: owner, admin, member are all `[identity_account]` |
| `identity_provider` | `owner`, `viewer` | `identity_provider.fga`: owner, viewer are assignable |
| `project` | `owner`, `viewer` | `project.fga`: owner, viewer are assignable |
| `agent` | `owner`, `viewer` | `agent.fga`: owner, viewer are assignable |
| `skill` | `owner`, `viewer` | same pattern |
| `workflow` | `owner`, `viewer` | same pattern |
| `mcp_server` | `owner`, `viewer` | same pattern |
| `session` | `owner`, `viewer` | `session.fga` |
| `environment` | `owner`, `viewer` | `environment.fga` |
| `agent_instance` | `owner`, `viewer` | `agent_instance.fga` |
| `workflow_instance` | `owner`, `viewer` | `workflow_instance.fga` |
| `workflow_execution` | `owner`, `viewer` | `workflow_execution.fga` |
| `iam_policy` | (none) | owner is set at creation, viewers are org admins |
| `api_key` | (none) | owner only, set at creation |
| `identity_account` | (none) | self-owned |
| `platform` | (none) | operator assigned differently |
| `execution_context` | (none) | owner only |
| `api_resource_version` | (none) | no authorization |
| `agent_execution` | (none) | inherited from session |

### Phase 5: Update `RpcAuthorizationConfig`

In `io.proto`, change the `permission` field type from `ApiResourceIamPermission` to `IamPermission`.

### Phase 6: Update all method option annotations

Every `command.proto` and `query.proto` that uses `(config).permission = can_edit` etc. needs to reference the new enum. If the enum name changes but values stay the same, this may just be a proto import change.

### Phase 7: Update backend Java code

The Java backend in `stigmer-cloud` that creates FGA tuples uses the old enum values for roles and structural relations. These need to reference `IamRole` for role-related tuple creation and use string constants for structural relations.

## Open Questions (for brainstorming)

1. **Proto package for `IamRole`**: Should it live in `rpcauthorization/` (same package as `IamPermission`) or in a new package like `iam/role/`? The `rpcauthorization` package name implies it's only for RPC auth, but roles are broader.

2. **Field number preservation**: When removing role values (10, 11, 26) and structural relation values (12, 13, 14, 15) from `ApiResourceIamPermission`, should we renumber the remaining values or keep them and add `reserved` statements? Keeping original numbers is safer for wire compatibility.

3. **Enum rename strategy**: Renaming `ApiResourceIamPermission` → `IamPermission` is a breaking change for all generated code. Options:
   - (a) Keep the old enum name, just remove non-permission values
   - (b) Rename and update all imports in one atomic commit
   - (c) Create `IamPermission` as a new enum, deprecate the old one, migrate incrementally
   
4. **`create` permission (value 1)**: This is used where exactly? Is it a real permission or a leftover? If it maps to a `can_create` pattern, it should stay. If it's unused, remove it.

5. **Circular import risk**: `authorization_config.proto` importing `iam_role.proto` creates a cross-package dependency from `commons/apiresource` → `iam/iampolicy`. Is this acceptable or should `IamRole` live in a shared location?

## Risks

- Proto field number conflicts if not carefully reserved
- Java backend compilation breakage (all enum references need updating)
- SDK codegen outputs change (TypeScript, Go, Python, Java clients)
- Method option annotations across ~30+ proto files need updating

## Next Steps

1. [ ] Review this plan and provide feedback
2. [ ] Resolve open questions through brainstorming
3. [ ] Create detailed implementation plan (T01_2_revised_plan.md)
4. [ ] Execute phase by phase with checkpoints
