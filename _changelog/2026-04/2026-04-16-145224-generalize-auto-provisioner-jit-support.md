# Generalize Auto-Provisioner for JIT Provisioning Support

**Date**: April 16, 2026

## Summary

Renamed `SsoAutoProvisioner` to `FederatedAutoProvisioner` and generalized the provisioning logic to support both SSO and JIT (Just-In-Time) provisioning modes. The provisioner now handles configurable roles, single-org and multi-tenant org grants, and tenant org resolution from JWT claims — completing the backend provisioning pipeline for the JIT provisioning feature.

## Problem Statement

The existing auto-provisioner (`SsoAutoProvisionerImpl`) was tightly coupled to SSO semantics: it always created an account and granted the hardcoded `viewer` role on the IdP's owning organization. With the introduction of JIT provisioning fields in T01 (proto) and T02 (auth token), the provisioner needed to support the full matrix of JIT configurations:

### Pain Points

- Hardcoded `viewer` role — platforms couldn't configure `member` or other roles
- Always granted on IdP's owning org — no support for multi-tenant org routing
- No support for `autoGrantOnOrg = false` (account-only provisioning without org access)
- SSO-specific naming throughout the codebase despite broader federated scope

## Solution

Renamed and generalized the auto-provisioner with a clean separation between SSO (backward-compatible, fixed semantics) and JIT (fully configurable) grant logic. Added tenant org resolution via the existing `OrganizationRepo.findByExternalOrgId` query, with fail-closed rejection when the target org doesn't exist.

## Implementation Details

### Phase 1: Rename (10 files, mechanical)
- `SsoAutoProvisioner` → `FederatedAutoProvisioner` (interface)
- `SsoAutoProvisioningException` → `FederatedAutoProvisioningException` (exception)
- `SsoAutoProvisionerImpl` → `FederatedAutoProvisionerImpl` (implementation)
- Updated all references in `RequestCallerIdentityMapper`, `GrpcRequestContextBuilderInterceptor`, `FederatedIdentityResolver`, `FederatedIdentityResolverImpl`, `BUILD.bazel`

### Phase 2: Generalize Logic (functional)
- Added `OrganizationRepo` constructor dependency for tenant org resolution
- New method `grantOrgRoleIfConfigured()` — branches on SSO vs JIT:
  - SSO: always grants `viewer` on IdP's owning org
  - JIT + `autoGrantOnOrg = false`: no grant (account-only)
  - JIT + `autoGrantOnOrg = true`: resolves target org + role, grants
- New method `resolveTargetOrg()` — single-tenant returns IdP's org; multi-tenant extracts JWT claim and resolves via `findByExternalOrgId`
- New method `resolveRole()` — returns configured role, defaulting to `viewer`
- Generalized `grantOrgRole(accountId, orgId, roleName)` — parameterized role

### Phase 3: Tests (7 new test cases)
- JIT no-grant, JIT viewer default, JIT member role
- Tenant org resolved, tenant org missing, claim missing
- SSO backward compatibility (ignores JIT fields)

## Benefits

- **Configurable roles**: Platforms can set `auto_grant_role = member` for trusted-user scenarios
- **Multi-tenant support**: `tenant_org_claim` enables JWT-driven org routing without backend provisioning steps
- **Account-only mode**: `autoGrantOnOrg = false` lets platforms manage access via IAM policies
- **Backward compatible**: All existing SSO flows work identically
- **Fail-closed security**: Missing tenant org rejects authentication with actionable error

## Impact

- **stigmer-cloud**: 10 production files changed (3 new, 3 deleted, 4 modified), 1 test file (new with 17 tests)
- **No proto changes**: T01 proto work is consumed, not modified
- **No API contract changes**: Internal refactoring, no gRPC service changes
- **Backward compatible**: SSO providers continue working without any configuration changes

## Related Work

- T01: Proto design — added JIT fields to `IdentityProviderSpec`
- T02: Auth token refactor — `IdentityProviderContext` record, `shouldAutoProvision()`
- T05 (upcoming): IdP validation — cross-field validation rules for JIT fields

---

**Status**: Production Ready
**Timeline**: Session 3 of JIT provisioning project (20260416.01)
