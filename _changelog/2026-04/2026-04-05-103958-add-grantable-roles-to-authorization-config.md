# Add grantable_roles to AuthorizationConfig per ApiResourceKind

**Date**: April 5, 2026

## Summary

Added a `grantable_roles` field to the FGA `AuthorizationConfig` message and populated it for all 19 `ApiResourceKind` values based on the FGA model source of truth. This enables the web app to render role selectors dynamically and SDKs to validate IAM policy role grants at creation time, without hardcoding role lists in clients.

## Problem Statement

After splitting the monolithic `ApiResourceIamPermission` enum into separate `IamRole` and `IamPermission` enums (session 1), there was no way for clients to know which roles are valid for a given resource kind. The web app's IAM policy creation form and SDKs would need to hardcode role lists per resource kind — violating the platform's configuration-driven authorization principle.

### Pain Points

- Web app role selectors would need hardcoded role lists that drift from the FGA model
- SDKs cannot validate whether a role grant is valid for a resource kind at creation time
- Adding a new resource kind with different grantable roles requires client-side code changes
- No single source of truth for "which roles can be granted on this resource kind"

## Solution

Extended `AuthorizationConfig` (the proto message embedded in every `ApiResourceKind` enum value) with a `repeated IamRole grantable_roles` field. Each resource kind now declaratively states which roles can be granted via IAM policies. Clients read this from generated proto metadata — no hardcoding needed.

## Implementation Details

### Field addition (`authorization_config.proto`)

- Added `import "ai/stigmer/iam/iampolicy/v1/enum.proto"` — verified no circular dependency (enum.proto is a leaf with zero imports)
- Added `repeated ai.stigmer.iam.iampolicy.v1.IamRole grantable_roles = 7` to the `AuthorizationConfig` message
- Extended message-level documentation with three new example configurations showing grantable_roles patterns

### Per-kind population (`api_resource_kind.proto`)

Derived from the 18 FGA model files in `stigmer-cloud/backend/services/stigmer-service/src/main/resources/fga/model/`:

| Category | Kinds | grantable_roles |
|----------|-------|-----------------|
| Three-tier hierarchy | organization | `[owner, admin, member]` |
| Standard org-scoped | agent, agent_instance, session, skill, mcp_server, workflow, workflow_instance, workflow_execution, environment, identity_provider, project | `[owner, viewer]` |
| No grantable roles | api_resource_version, iam_policy, identity_account, api_key, platform, agent_execution, execution_context | (empty default) |

### Design decision: `repeated IamRole` over `repeated string`

The grantable role vocabulary is closed (4 values) and maps 1:1 to the `IamRole` enum created in session 1. Edge cases that might argue for strings (`creator` on environment, `operator` on platform) are correctly excluded: `creator` is an immutable attribution handled by `requires_creator_tuple`, and `operator` is a platform concept outside the IAM policy model.

## Benefits

- **Configuration-driven**: Web app reads grantable roles from proto metadata, no hardcoded lists
- **Type-safe**: Invalid roles caught at proto compile time, not at runtime
- **Self-documenting**: Each resource kind's authorization config now tells the complete story — scope, ownership, visibility, parent links, creator attribution, AND grantable roles
- **Extensible**: Adding a new resource kind with custom grantable roles requires only proto config

## Impact

- **Web app**: Can dynamically render role selectors by reading `grantable_roles` from `ApiResourceKind` metadata
- **SDKs**: Can validate IAM policy `relation` field against the target resource kind's grantable roles
- **Backend**: No runtime changes needed — `grantable_roles` is client-facing metadata; `AuthorizationConfigResolver` and `IamPolicyCreationService` continue to use the existing fields for tuple creation

## Related Work

- Session 1: [IAM Role/Permission Separation and Package Relocation](2026-04-05-101218-iam-role-permission-separation-and-package-relocation.md) — split enum, created `IamRole`, relocated packages
- Next: Phase 7 — Update SDK codegen and web app to consume `grantable_roles`

---

**Status**: ✅ Production Ready (awaiting codegen run to regenerate stubs)
**Timeline**: Session 2 of the IAM role/permission separation project
