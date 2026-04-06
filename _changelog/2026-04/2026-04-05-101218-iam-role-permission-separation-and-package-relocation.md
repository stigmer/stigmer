# IAM Role/Permission Separation and Package Relocation

**Date**: April 5, 2026

## Summary

Split the monolithic `ApiResourceIamPermission` enum into separate `IamRole` and `IamPermission` enums, removed structural FGA relations and stale values, and relocated all RPC authorization proto definitions to follow established package conventions. Updated all 36 command/query proto files and 64 Java backend source files across both repos.

## Problem Statement

The `ApiResourceIamPermission` enum conflated three fundamentally different concepts in a single enum: roles (owner, member, viewer), permissions (can_view, can_edit, etc.), and structural FGA relations (organization, session, agent). This made it impossible to build role selectors, validate IAM policy creation, or generate clear documentation. Additionally, the enum and config lived in an `rpcauthorization/` subfolder that broke the established package patterns used across all other domains.

### Pain Points

- No `admin` role despite it existing in the FGA model
- `create` permission had no corresponding FGA relation (dead value)
- Structural relations (organization, identity_account, session, agent) mixed with assignable roles and computed permissions
- Reserved field numbers and gaps from prior removals cluttered the enum
- Enums in `rpcauthorization/` broke the `enum.proto` pattern used by every other domain
- `RpcAuthorizationConfig` message was domain-specific rather than in commons where it logically belongs

## Solution

Two-phase refactoring:

1. **Enum split**: Create `IamRole` (4 values: owner, admin, member, viewer) and `IamPermission` (20 permissions, cleanly numbered 1-20) as separate enums. Remove structural relations and the unused `create` value entirely.

2. **Package relocation**: Move enums to `iam/iampolicy/v1/enum.proto` (matching domain conventions), move `RpcAuthorizationConfig` and method option extensions to `commons/rpc/` (shared infrastructure alongside `pagination.proto`). Delete the entire `rpcauthorization/` subfolder.

## Implementation Details

### Proto changes (stigmer repo — 43 files)

**New files:**
- `apis/ai/stigmer/iam/iampolicy/v1/enum.proto` — `IamPermission` + `IamRole` enums in package `ai.stigmer.iam.iampolicy.v1`
- `apis/ai/stigmer/commons/rpc/config.proto` — `RpcAuthorizationConfig` message in package `ai.stigmer.commons.rpc`
- `apis/ai/stigmer/commons/rpc/method_options.proto` — `config`, `is_public`, `is_skip_authorization` extensions

**Deleted:**
- `apis/ai/stigmer/iam/iampolicy/v1/rpcauthorization/iam_permission.proto`
- `apis/ai/stigmer/iam/iampolicy/v1/rpcauthorization/io.proto`
- `apis/ai/stigmer/iam/iampolicy/v1/rpcauthorization/method_options.proto`

**Updated 36 command/query/service proto files:**
- Import: `rpcauthorization/method_options.proto` → `commons/rpc/method_options.proto`
- All option annotations: `ai.stigmer.iam.iampolicy.v1.rpcauthorization.config` → `ai.stigmer.commons.rpc.config` (and `is_public`, `is_skip_authorization`)

### Java changes (stigmer-cloud repo — 64 files)

- `IamPermission` imports → `protos.ai.stigmer.iam.iampolicy.v1.IamPermission`
- `IamRole` imports → `protos.ai.stigmer.iam.iampolicy.v1.IamRole`
- `RpcAuthorizationConfig` imports → `protos.ai.stigmer.commons.rpc.RpcAuthorizationConfig`
- `MethodOptionsProto` references → `protos.ai.stigmer.commons.rpc.MethodOptionsProto`
- `IamPolicyCreationService`: organization relation now uses `ApiResourceKind.organization.name()` instead of raw string
- `IamPolicyCreationService`: owner/viewer relations use `IamRole.owner.name()` / `IamRole.viewer.name()`

## Benefits

- **Clear semantic separation**: Roles (assignable by users) vs permissions (checked by interceptor) vs structural relations (internal FGA wiring) are now distinct types
- **`admin` role**: First-class role that was missing from proto but existed in FGA model
- **Clean numbering**: IamPermission values 1-20, IamRole values 1-4, no gaps or reserved slots
- **Pattern consistency**: Enums in `enum.proto` like every other domain, shared config in `commons/rpc/`
- **Web app enablement**: `IamRole` enum enables dynamic role selectors and IAM policy validation
- **SDK validation**: Clients can validate role assignments at creation time

## Impact

- All proto stubs (Go, TypeScript, Python, Java, Dart) need regeneration via normal build pipeline
- No wire-format backward compatibility concerns — the old enum was not yet in production use
- Generated Java class paths change (rpcauthorization package removed from path)

## Related Work

- Follows up on prior FGA authorization config work that made `AuthorizationConfig` proto-driven
- Prepares for adding `grantable_roles` per `ApiResourceKind` (next phase)
- Enables identity provider flow work that needs proper role-based IAM policies

---

**Status**: Production Ready
**Timeline**: Single session
