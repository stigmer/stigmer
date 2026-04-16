# Task T02: Backend -- FederatedAuthenticationToken JIT Fields

**Created**: 2026-04-16
**Status**: COMPLETED
**Type**: Feature Development

## Objective

Add JIT provisioning fields to the federated authentication pipeline by introducing an `IdentityProviderContext` record, carrying `auto_provision_accounts`, `auto_grant_on_org`, `auto_grant_role`, and `tenant_org_claim` through `FederatedAuthenticationToken` to the downstream provisioner.

## Edition Classification

**Cloud-only.** Federation and IdP-based authentication are cloud features (`stigmer-cloud`). The OSS `stigmer-server` does not implement federated auth. No changes needed in the `stigmer` repo.

## Design Decisions

1. **`autoGrantRole` as `String`** -- preserves proto-free layering in the `api-authentication` library. The conversion from `IamRole` enum to String happens at the boundary in `FederatedJwtAuthenticationProvider` (which already imports proto types). The token carries raw config faithfully; the provisioner (T03) applies business defaults (empty string -> "viewer").

2. **`IdentityProviderContext` record** -- groups all 8 IdP-related fields into a single immutable concept. The `FederatedAuthenticationToken` constructor becomes `(Jwt, authorities, IdentityProviderContext)`, cleanly separating Spring's JWT auth concern from Stigmer's IdP configuration concern.

## File Changes (1 new, 4 modified production, 4 modified test)

### NEW: `IdentityProviderContext.java`

Path: `backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/federation/IdentityProviderContext.java`

Java record with 8 fields (id, org, slug, isSsoProvider, autoProvisionAccounts, autoGrantOnOrg, autoGrantRole, tenantOrgClaim) + `shouldAutoProvision()` convenience method.

### MODIFIED: `FederatedAuthenticationToken.java`

Replaced 4 individual fields and 2 constructors with single `IdentityProviderContext` field and 1 constructor. Added delegate getters for backward compatibility.

### MODIFIED: `FederatedJwtAuthenticationProvider.java`

Builds `IdentityProviderContext` from proto spec, converts `IamRole` -> String at boundary (`iam_role_unspecified` -> empty string).

### MODIFIED: `RequestCallerIdentityMapper.java`

Changed auto-provision check from `fedAuth.isSsoProvider()` to `fedAuth.getIdentityProvider().shouldAutoProvision()`. Non-SSO IdPs with `autoProvisionAccounts = true` now trigger auto-provisioning.

### Test Updates

- `FederatedJwtAuthenticationProviderTest.java`: Added `jitFieldsPropagated` and `unsetAutoGrantRole_carriedAsEmptyString` tests
- `RequestCallerIdentityMapperTest.java`: Added `jitProviderNoAccount_autoProvisions` test
- `SsoAutoProvisionerImplTest.java`: Updated helpers to use `IdentityProviderContext`
- `AuthenticationTokenParserTest.java`: Updated helpers to use `IdentityProviderContext`

## What T02 Does NOT Do

- Does not modify the provisioner (T03)
- Does not rename SsoAutoProvisioner (T03)
- Does not add validation (T05)
- Does not resolve tenant orgs (T06)
- Does not touch proto files (T01)

## Verification

- All 4 Bazel test targets pass
- Full library compilation verified (`api-authentication` + `stigmer-service`)
