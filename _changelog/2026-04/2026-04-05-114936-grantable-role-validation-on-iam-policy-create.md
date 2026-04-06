# Grantable Role Validation on IAM Policy Create

**Date**: April 5, 2026

## Summary

Added a server-side validation guardrail to the user-facing IAM policy `create` RPC that rejects invalid role grants before they become FGA tuples. The backend now validates that the requested `relation` is in the target resource kind's `grantable_roles` list, returning `INVALID_ARGUMENT` with descriptive error messages for invalid grants.

## Problem Statement

The IAM policy `create` RPC accepted any string as the `relation` field and wrote it directly to OpenFGA as an authorization tuple. There was no server-side enforcement that the relation was actually a grantable role for the target resource kind.

### Pain Points

- A caller could create an IAM policy with `relation: "organization"` (a structural FGA relation, not a role) on the `create` path, producing a semantically invalid tuple
- A caller could grant `admin` on an `agent` resource, even though agents only support `owner` and `viewer` roles
- Resource kinds with no user-grantable roles (e.g., `api_key`, `identity_account`) had no server-side protection against user-created IAM policies

## Solution

Added a `ValidateGrantableRole` pipeline step to `IamPolicyCreateHandler` that validates the `relation` string against the target resource kind's `grantable_roles` authorization config (populated in phases 1-6 of the IAM role-permission separation project).

The validation applies only to the user-facing `create` path. The system-internal `bootstrapPolicy` path is intentionally excluded because it legitimately writes structural relations and creator tuples that are not user-grantable roles.

## Implementation Details

### `AuthorizationConfigResolver` (api-shape library)

Added two query methods consistent with the existing API surface:

- `hasGrantableRoles(ApiResourceKind kind)` — returns true if the kind has a non-empty `grantable_roles` list
- `getGrantableRoles(ApiResourceKind kind)` — returns `List<IamRole>` from the resolved config

### `IamPolicyCreateHandler` (stigmer-service)

Added `ValidateGrantableRole` as a new pipeline step between `authorize` and `checkIfDuplicate`:

- After `authorize`: unauthorized callers don't learn which roles are valid (principle of least information)
- Before `checkIfDuplicate`: no point checking duplicates for an invalid role

The step handles three rejection cases with descriptive `INVALID_ARGUMENT` messages:
- Unknown resource kind string
- Resource kind with no grantable roles (system-managed)
- Relation not in the allowed grantable roles list (includes the allowed list in the error message)

## Benefits

- **Data integrity**: Invalid FGA tuples can no longer be created through the user-facing API
- **Clear error messages**: Callers receive actionable feedback including the list of valid roles
- **Zero bootstrap impact**: System-internal tuple creation is unaffected
- **Extensibility**: Adding new resource kinds with grantable roles automatically enables validation — no code changes needed

## Impact

- **API consumers**: Will receive `INVALID_ARGUMENT` errors for previously-silent invalid grants
- **Web app**: Can rely on server-side validation as a safety net behind UI role selectors
- **SDKs**: Can use `grantable_roles` for client-side validation with server-side enforcement as backup
- **Bootstrap path**: No impact — `IamPolicyBootstrapPolicyHandler` continues to work unchanged

## Related Work

- Part of [IAM Role/Permission Separation](../_projects/2026-04/20260405.01.iam-role-permission-separation/) project (phase 7 backend validation)
- Builds on `grantable_roles` proto metadata populated in sessions 1-3

---

**Status**: Production Ready
**Timeline**: 1 session (Session 4 of the IAM role-permission separation project)
