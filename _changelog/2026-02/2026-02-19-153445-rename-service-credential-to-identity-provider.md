# Rename ServiceCredential to IdentityProvider + Remove Orphaned Credential

**Date**: February 19, 2026

## Summary

Renamed the `ServiceCredential` resource to `IdentityProvider` across the entire proto layer, and removed the orphaned `Credential` enum entry that had no implementation. The rename corrects a domain modelling error: the resource stores JWKS URI, allowed issuers, and expected audience — pure identity validation configuration with no stored secrets. `IdentityProvider` is the industry-standard term for exactly this pattern (AWS IAM OIDCProvider, GCP Workload Identity Pool Provider, Okta, Keycloak). This brings Stigmer's IAM vocabulary into alignment with the broader industry.

## Problem Statement

Two naming issues existed in `ApiResourceKind`:

### Pain Points

- `credential = 20` was a phantom entry in the enum — no proto package existed under `iam/credential/`, no backend code referenced it, and it had `SCOPE_TYPE_NONE / OWNER_TYPE_NONE` (effectively disabled). It was dead code in the platform's type registry.
- `service_credential = 21` was architecturally misnamed. A "credential" is something you *present* to prove identity (a password, an API key, a certificate, a token). This resource stores none of that — it holds a JWKS URI (a public URL to the platform's signing keys), a list of allowed issuers, and an expected audience value. These are identity *validation* configuration fields, not credentials.
- The mismatch created confusion between `management_mode = platform_managed` and `service_credential_ref` — the org is "platform-managed" but the reference is to a "service credential"? The domain language was fractured.
- `svc` as an id prefix is an ambiguous Kubernetes borrowing; it collides conceptually with how engineers think about services in a microservice context.

## Solution

Renamed to `IdentityProvider` — the standard name for a resource that configures how Stigmer validates identity assertions from an external platform. The new name:

- Matches what AWS, GCP, Okta, Keycloak, and HashiCorp all call this exact resource
- Pairs naturally with `identity_account` in the IAM group (a provider provides accounts)
- Aligns with `management_mode = platform_managed` + `identity_provider_ref` (coherent language)
- Carries no false implication of stored secrets

## Implementation Details

### ApiResourceKind Changes (`api_resource_kind.proto`)

- **Removed** `credential = 20` — orphaned entry with no proto package, no backend code, `SCOPE_TYPE_NONE`
- **Renamed** `service_credential = 21` → `identity_provider = 21` (numeric value preserved for wire compatibility)
  - `name`: `"ServiceCredential"` → `"IdentityProvider"`
  - `display_name`: `"Service Credential"` → `"Identity Provider"`
  - `id_prefix`: `"svc"` → `"idp"` (industry-standard abbreviation)

### New Proto Package: `apis/ai/stigmer/iam/identityprovider/v1/`

Seven files, all semantically rewritten (not just find-and-replace):

| File | Key Change |
|------|-----------|
| `api.proto` | `IdentityProvider` root message; `kind` const = `"IdentityProvider"` |
| `spec.proto` | `IdentityProviderSpec`; all 5 fields unchanged |
| `status.proto` | `IdentityProviderStatus` + `IdentityProviderLifecycleState` reference |
| `enum.proto` | `IdentityProviderLifecycleState` (active / suspended / revoked) |
| `io.proto` | `IdentityProviderId`, `IdentityProviders`, `IdentityProviderList` |
| `command.proto` | `IdentityProviderCommandController` (apply / create / update / delete) |
| `query.proto` | `IdentityProviderQueryController` (get / getByReference) |

### OrganizationSpec (`tenancy/organization/v1/spec.proto`)

- Field `service_credential_ref` renamed to `identity_provider_ref` (field number 4 preserved)
- Comment updated to reflect that the identity provider *authenticates requests for* the org, not *manages* it — a subtle but important separation of concerns

### OrganizationSpec Enum (`tenancy/organization/v1/enum.proto`)

- `ManagementMode` comment updated: references `IdentityProvider` instead of `ServiceCredential`

### Go Stubs Regenerated

- Deleted: `apis/stubs/go/ai/stigmer/iam/servicecredential/v1/` (9 files)
- Generated: `apis/stubs/go/ai/stigmer/iam/identityprovider/v1/` (9 files)
- Updated: `api_resource_kind.pb.go`, `authorization_config.pb.go`, `organization/v1/spec.pb.go`, `organization/v1/enum.pb.go`

### Deleted: `apis/ai/stigmer/iam/servicecredential/v1/`

All 7 proto source files removed.

### Project Documentation Updated

- `_projects/2026-02/20260218.01.stigmer-planton-integration/next-task.md`
- `_projects/2026-02/20260218.01.stigmer-planton-integration/checkpoints/2026-02-19-session-1.md`
- `_projects/2026-02/20260218.01.stigmer-planton-integration/tasks/T01_0_plan.md`

## Benefits

- **Ubiquitous language**: IAM vocabulary now matches industry standard. Any engineer familiar with OIDC federation immediately understands `IdentityProvider`.
- **No false implications**: Engineers won't search for stored secrets in a resource that has none.
- **Coherent phrasing**: `management_mode = platform_managed` + `identity_provider_ref` reads as a single thought.
- **Natural grouping**: `identity_provider` sits alongside `identity_account` in the IAM group — the provider vouches for accounts.
- **Zero breaking changes**: All proto field numbers and enum numeric values preserved. Only names changed.

## Impact

- **stigmer-cloud (Java)**: No changes required — IdentityProvider CRUD has not been implemented yet (Phase 1 of the Planton integration).
- **backend (Go)**: No changes required — zero references to `service_credential` or `ServiceCredential` existed in backend code.
- **proto wire format**: Fully compatible — field numbers and enum values unchanged.
- **Go stubs**: Regenerated clean. `ApiResourceKind_identity_provider = 21`, `GetIdentityProviderRef()` accessor generated.

## Related Work

- [Planton Integration: T01 Architecture Plan](_projects/2026-02/20260218.01.stigmer-planton-integration/tasks/T01_0_plan.md) — Phase 1 context
- Next: Implement `IdentityProvider` CRUD in `stigmer-cloud` (Temporal workflow, MongoDB repo, FGA tuples, gRPC controller)

---

**Status**: Production Ready
**Timeline**: Single session, 2026-02-19
