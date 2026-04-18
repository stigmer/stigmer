# IdentityProvider Proto Authorization Cleanup

**Date**: February 20, 2026

## Summary

Corrected the IdentityProvider `create` RPC authorization to use a dedicated `can_create_idp` permission instead of the generic `can_edit`, aligning with the established FGA pattern where every org-scoped resource has its own `can_create_<resource>` permission. Also simplified the status model by removing the unnecessary `IdentityProviderStatus` wrapper in favor of `ApiResourceAuditStatus` directly, matching the IdentityAccount pattern.

## Problem Statement

The IdentityProvider proto definitions had two issues that diverged from established platform conventions:

### Pain Points

- The `create` RPC on `IdentityProviderCommandController` used `can_edit` on the organization, which is a generic CRUD permission. Every other resource (agent, workflow, session, skill, project) uses a dedicated `can_create_<resource>` permission on the organization. This inconsistency would make IDP creation authorization behave differently from all other resources.
- The `IdentityProviderStatus` message was a pure pass-through wrapper containing only a `reserved 1` field and `audit = 99`. Resources with no domain-specific status fields (like IdentityAccount) use `ApiResourceAuditStatus` directly -- the wrapper added a layer of indirection for no benefit.
- The `reserved 1` field in status.proto was unnecessary since the platform is in dev and no consumers depend on wire compatibility.

## Solution

Four targeted changes across `stigmer` (proto) and `stigmer-cloud` (FGA model) to bring IdentityProvider in line with existing conventions:

1. Add `can_create_idp` to the IAM permission enum
2. Update the `create` RPC to use the new permission
3. Delete the wrapper `IdentityProviderStatus` message and use `ApiResourceAuditStatus` directly
4. Add corresponding `can_create_idp: admin` to the organization FGA model

## Implementation Details

### Proto changes (stigmer repo)

**iam_permission.proto** -- Added `can_create_idp = 24` as the next available enum value in the resource-specific creation permissions section. This uses the abbreviated form "idp" rather than the full "identity_provider" for brevity -- a deliberate naming choice since `can_create_identity_provider` would be the longest permission name in the enum by a wide margin.

**command.proto** -- Changed the `create` RPC's permission option from `can_edit` to `can_create_idp`. The `resource_kind` remains `organization` and `field_path` remains `metadata.org`, since IDP creation is authorized against the owning org. The `update` and `delete` RPCs remain unchanged (they correctly authorize against the IDP resource itself).

**status.proto** -- Deleted entirely. The `IdentityProviderStatus` wrapper message contained only `reserved 1` and `audit = 99` with no domain-specific fields.

**api.proto** -- Replaced the `IdentityProviderStatus status = 5` field with `ai.stigmer.commons.apiresource.ApiResourceAuditStatus status = 5`, swapping the import accordingly. This mirrors the IdentityAccount pattern exactly.

### FGA model change (stigmer-cloud repo)

**organization.fga** -- Added `define can_create_idp: admin` to the resource creation permissions section. Without this, the proto authorization check would always deny since the FGA permission name must match the proto enum value exactly. Placed alongside existing `can_create_*` permissions, before `can_create_execution_in` (which uniquely grants to `member` rather than `admin`).

## Benefits

- **Authorization consistency**: IDP creation now follows the same `can_create_<resource>` pattern as every other org-scoped resource, making the authorization model predictable and auditable.
- **Granular access control**: Organizations can now independently control who can create IDPs vs who can edit org settings. Previously both used `can_edit`, making them inseparable.
- **Simpler status model**: Removing the wrapper eliminates an unnecessary layer of indirection. If domain-specific status fields are needed later, a wrapper can be reintroduced.
- **No reserved fields in dev**: Removing `reserved 1` keeps the proto clean while we're still iterating on the schema.

## Impact

- **Proto consumers**: Generated stubs in all languages (Go, Java, Python, TypeScript, Dart) will change on next `buf generate`. The field number (5) is unchanged, so existing serialized data (if any) remains compatible.
- **Backend handlers**: No hand-written code in stigmer-cloud directly references `IdentityProviderStatus`. Handlers use generated proto classes that will be updated on stub regeneration.
- **FGA authorization**: The create RPC will now check `can_create_idp` instead of `can_edit`. Any existing FGA tuples granting `can_edit` on organizations still work for `update` operations but no longer implicitly authorize IDP creation -- this is the correct behavior.

## Related Work

- IdentityProvider CRUD implementation (session 4) -- this cleanup refines the authorization model established there
- Planton integration project -- IDP is the trust anchor for federated authentication

---

**Status**: Production Ready
**Timeline**: Single session
