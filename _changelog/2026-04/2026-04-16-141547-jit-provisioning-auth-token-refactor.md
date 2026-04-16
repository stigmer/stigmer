# JIT Provisioning: IdentityProviderContext and Auth Pipeline Extension

**Date**: April 16, 2026

## Summary

Introduced `IdentityProviderContext` as a first-class abstraction in the federated authentication pipeline and extended `RequestCallerIdentityMapper` to support JIT (Just-In-Time) auto-provisioning alongside the existing SSO path. This is the second task (T02) of the JIT provisioning project, which enables zero-friction federation where a platform JWT works end-to-end without manual account creation.

## Problem Statement

After adding JIT provisioning fields to the `IdentityProviderSpec` proto (T01), the backend auth pipeline had no way to carry these fields through authentication to the downstream provisioner. The `FederatedAuthenticationToken` only carried 4 IdP-related fields, and the auto-provisioning decision in `RequestCallerIdentityMapper` was hardcoded to SSO providers only.

### Pain Points

- `FederatedAuthenticationToken` used 4 individual fields for IdP context, with no room for the 4 new JIT fields without creating a 10-parameter constructor
- Auto-provisioning was gated exclusively on `isSsoProvider`, preventing non-SSO IdPs with `auto_provision_accounts = true` from triggering account creation
- No clean separation between Spring's JWT auth concern and Stigmer's IdP configuration concern in the token class

## Solution

Introduced `IdentityProviderContext` as an immutable Java record that groups all 8 IdP-related fields into a single concept, and refactored the auth pipeline to use it throughout.

## Implementation Details

### New: `IdentityProviderContext` record

An immutable record in the `api-authentication` library with 8 fields: `id`, `org`, `slug`, `isSsoProvider`, `autoProvisionAccounts`, `autoGrantOnOrg`, `autoGrantRole`, `tenantOrgClaim`. Includes `shouldAutoProvision()` method that encapsulates the SSO-or-JIT decision logic.

Key design choice: `autoGrantRole` is carried as `String` (not the proto `IamRole` enum) to preserve the proto-free layering of the `api-authentication` library. The `IamRole` -> String conversion happens in `FederatedJwtAuthenticationProvider` at the proto boundary.

### Refactored: `FederatedAuthenticationToken`

Replaced 4 individual fields and 2 constructors with a single `IdentityProviderContext` field and 1 constructor. Added delegate getters for backward compatibility with existing consumers that reference `getIdentityProviderId()`, `getIdentityProviderOrg()`, etc.

### Updated: `FederatedJwtAuthenticationProvider`

Now builds the full `IdentityProviderContext` from the matched `IdentityProviderSpec` proto, including `IamRole` -> String conversion (`iam_role_unspecified` -> empty string, preserving the "unset" semantic for the provisioner to apply defaults).

### Extended: `RequestCallerIdentityMapper`

Changed the auto-provisioning decision from `fedAuth.isSsoProvider()` to `fedAuth.getIdentityProvider().shouldAutoProvision()`. This is the key behavioral change: non-SSO IdPs with `autoProvisionAccounts = true` now trigger the auto-provisioner. Error messages updated to guide users toward `auto_provision_accounts` as an alternative to manual account creation.

### Tests

- 3 new test cases: JIT field propagation, unset role conversion, JIT auto-provisioning trigger
- All existing test helpers updated to use `IdentityProviderContext`-based constructors
- 4/4 Bazel test targets pass

## Benefits

- **Clean abstraction**: IdP configuration is now a single concept (`IdentityProviderContext`) instead of scattered fields
- **Extensible**: Adding future IdP config fields requires only adding to the record, not changing constructor signatures across multiple files
- **Proto-free layering preserved**: The `api-authentication` library remains free of proto type dependencies
- **JIT pipeline ready**: The auth pipeline now carries and acts on all 4 JIT fields, ready for T03 (provisioner generalization)

## Impact

- **Backend auth pipeline** (stigmer-cloud): 1 new file, 4 modified production files, 4 modified test files
- **Behavioral change**: Non-SSO IdPs with `auto_provision_accounts = true` now trigger auto-provisioning (previously required SSO flag)
- **No breaking changes**: Delegate getters on `FederatedAuthenticationToken` ensure backward compatibility
- **No proto changes**: T02 is purely a backend Java change in stigmer-cloud

## Related Work

- **T01**: Proto design and implementation (completed in session 1) — added `auto_provision_accounts`, `auto_grant_on_org`, `auto_grant_role`, `tenant_org_claim` fields to `IdentityProviderSpec`
- **T03** (next): Generalize `SsoAutoProvisionerImpl` to `FederatedAutoProvisionerImpl` — the provisioner will consume the JIT fields carried by `IdentityProviderContext`
- **DD-001**: Separate identity and authorization controls — the `autoProvisionAccounts` (identity) vs `autoGrantOnOrg` (authorization) separation is preserved through the record

---

**Status**: Production Ready
**Timeline**: 1 session (~2 hours)
