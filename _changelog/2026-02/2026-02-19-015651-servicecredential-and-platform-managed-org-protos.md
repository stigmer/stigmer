# ServiceCredential and Platform-Managed Organization Proto Layer

**Date**: February 19, 2026

## Summary

Introduces the proto-layer foundation for Stigmer's Planton integration. A new `ManagementMode` enum extends the organization model to distinguish user-operated orgs from platform-managed ones. A new `ServiceCredential` resource formalizes how external platforms register their trust relationship with Stigmer. These definitions live in the shared `stigmer/apis/` package and their Go stubs are generated; cloud-layer implementation (controllers, storage, FGA) follows in `stigmer-cloud`.

## Problem Statement

Planton needs to create and operate Stigmer organizations on behalf of its users — provisioning agents, triggering workflows, and passing user identity for authorization. Stigmer had no model for:

### Pain Points

- No way to distinguish a user-created org from one operated by an external platform
- No resource to represent an external platform's trust relationship (JWKS config, issuer, audience)
- No reverse-lookup key when a Stigmer slug must differ from the platform's original slug
- No lifecycle states for programmatic credentials (active → suspended → revoked)
- No authorization scope registered for service credentials in the `ApiResourceKind` registry

## Solution

Two targeted proto additions that integrate cleanly into the existing resource model without altering any existing behavior:

1. **`ManagementMode` enum** on `OrganizationSpec` — a single field that declares how an org was created and who may operate it
2. **`ServiceCredential` resource** — a first-class org-scoped resource holding the external platform's JWKS URI, allowed issuers, expected audience, and rate-limit budget

Both are `TIER_CLOUD_ONLY`; the OSS server does not implement controllers for them.

## Implementation Details

### ManagementMode enum — `apis/ai/stigmer/tenancy/organization/v1/enum.proto` (new)

```proto
enum ManagementMode {
  management_mode_unspecified = 0;
  self_managed = 1;      // user-operated via Stigmer UI/CLI/API
  platform_managed = 2;  // operated programmatically by external platform via ServiceCredential
}
```

No per-value prefix (enum name already provides namespace). `_managed` suffix kept for human readability.

### OrganizationSpec extensions — `apis/ai/stigmer/tenancy/organization/v1/spec.proto` (modified)

Three new fields added after the existing `logo_url` field:

| Field | Type | Purpose |
|---|---|---|
| `management_mode` | `ManagementMode` | Immutable after creation; defaults to `self_managed` |
| `service_credential_ref` | `ApiResourceReference` | Required for `platform_managed`; identifies the managing credential (org + kind + slug) |
| `external_org_id` | `string` | Reverse-lookup: the external platform's own org ID, for when the Stigmer slug was made unique |

`service_credential_ref` uses the same `ApiResourceReference` type that `AgentSpec` uses for `skill_refs` and `mcp_server_ref`, maintaining consistency.

### ServiceCredential resource — `apis/ai/stigmer/iam/servicecredential/v1/` (new package, 7 files)

| File | Contents |
|---|---|
| `enum.proto` | `ServiceCredentialLifecycleState`: `active`, `suspended`, `revoked` |
| `spec.proto` | `ServiceCredentialSpec`: `display_name`, `jwks_uri`, `allowed_issuers`, `expected_audience`, `rate_limit_budget` |
| `status.proto` | `ServiceCredentialStatus`: `lifecycle_state` + `audit` |
| `api.proto` | Top-level `ServiceCredential` message (`api_version`, `kind`, `metadata`, `spec`, `status`) |
| `io.proto` | `ServiceCredentialId`, `ServiceCredentials`, `ServiceCredentialList` |
| `command.proto` | `ServiceCredentialCommandController`: `apply`, `create`, `update`, `delete` RPCs with auth config |
| `query.proto` | `ServiceCredentialQueryController`: `get` (by ID), `getByReference` (by org + slug) RPCs |

Authorization for `create` is checked against the owning `organization` (`can_edit`); `update`/`delete` checked against the `service_credential` itself.

### ApiResourceKind registration — `apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto` (modified)

```proto
service_credential = 21 [(kind_meta) = {
  group: iam
  version: v1
  name: "ServiceCredential"
  display_name: "Service Credential"
  id_prefix: "svc"
  is_versioned: false
  not_search_indexed: true
  tier: TIER_CLOUD_ONLY
  authorization: {
    scope_type: AUTHORIZATION_SCOPE_TYPE_ORGANIZATION
    owner_type: OWNER_ATTRIBUTION_TYPE_DIRECT
  }
}];
```

ID prefix `svc` chosen to be short and collision-free with existing prefixes.

### Go stubs regenerated

`apis/stubs/go/ai/stigmer/iam/servicecredential/` and updated files in `tenancy/organization/v1/` and `commons/apiresource/apiresourcekind/` are now in sync.

## Benefits

- **Zero breaking changes** — all new fields are optional; existing orgs default to `self_managed` with no action required
- **Consistent patterns** — `ApiResourceReference` for cross-resource references, `ApiResourceKind` for authorization scope, `_unspecified = 0` for all enums
- **Clean tier separation** — proto definitions shared; cloud-only implementation stays in `stigmer-cloud`
- **Future-proof** — `jwks_uri`, `allowed_issuers`, `expected_audience` defined now; JWT validation wired in Phase 2 without proto changes

## Impact

- **Stigmer APIs**: New `ServiceCredential` resource available in the API registry; Organization API surface extended with three new fields
- **stigmer-cloud**: Phase 1 cloud implementation can now begin using these proto definitions (Java gRPC stubs to be generated)
- **Planton**: Integration path is now formally modeled; implementation work can proceed on both sides
- **OSS users**: No visible change — `management_mode` defaults to `self_managed`, new fields are ignored if not set

## Related Work

- Project: `_projects/2026-02/20260218.01.stigmer-planton-integration/`
- Architecture plan: `tasks/T01_0_plan.md`
- Session checkpoint: `checkpoints/2026-02-19-session-1.md`
- Phase 2 will add `provisioning_mode` to `IdentityAccount` and wire JWT assertion validation

---

**Status**: ✅ Proto Layer Complete — Cloud implementation pending in `stigmer-cloud`
**Timeline**: 1 session (2026-02-19)
