# JIT Provisioning: IdP Cross-Field Validation

**Date**: April 16, 2026

## Summary

Added write-time validation for JIT provisioning field combinations on IdentityProvider create and update. Six cross-field rules prevent invalid configurations that would silently misbehave at runtime — including phantom config on SSO providers, missing dependency chains between provisioning and authorization fields, and the auto-grant of the owner role.

## Problem Statement

The four JIT provisioning fields (`auto_provision_accounts`, `auto_grant_on_org`, `auto_grant_role`, `tenant_org_claim`) added in T01-T03 have dependency relationships that cannot be expressed as individual field constraints. Without cross-field validation, users can save configurations that are structurally valid but semantically broken:

### Pain Points

- Setting `auto_grant_on_org = true` without `auto_provision_accounts = true` — grants require an account to exist first
- Setting `tenant_org_claim` without `auto_grant_on_org` — resolves a tenant org but never grants a role on it
- Setting `auto_grant_role = member` on an SSO provider — SSO always grants viewer; the role setting has no effect
- Setting `auto_grant_role = owner` — organization ownership must never be auto-assigned

## Solution

A new `ValidateJitFields` pipeline step that enforces six cross-field rules at write time, producing actionable `INVALID_ARGUMENT` errors. The step follows the same `RequestPipelineStepV2<ContextBase<...>>` pattern as the existing `ValidateSsoFields` and `ValidateIssuerUniqueness` steps.

## Implementation Details

### ValidateJitFields.java

Pure field-level validation — no database dependencies. Six rules evaluated in priority order:

1. **SSO/JIT separation**: JIT authorization fields rejected when `is_sso_provider = true` (DD-004)
2. **Grant requires provisioning**: `auto_grant_on_org` requires `auto_provision_accounts`
3. **Tenant claim requires provisioning**: `tenant_org_claim` requires `auto_provision_accounts`
4. **Tenant claim requires grants**: `tenant_org_claim` requires `auto_grant_on_org`
5. **Orphaned role**: `auto_grant_role` (non-default) requires `auto_grant_on_org`
6. **Owner not auto-grantable**: `auto_grant_role = owner` rejected

### Pipeline Placement

Inserted after `validateSsoFields`, before `normalizeIssuerUrls` in both `IdentityProviderCreateHandler` and `IdentityProviderUpdateHandler`. SSO validation runs first (uniqueness, platform delegation guard), then JIT validation.

### Test Coverage

14 test cases: 6 rejection cases (one per rule), 2 SSO edge cases (SSO + `auto_provision_accounts` allowed; SSO + `auto_grant_role` rejected), 6 valid configuration acceptance tests covering all five provisioning modes (manual, single-org JIT, single-org JIT with role, multi-tenant JIT, account-only JIT, SSO only).

## Benefits

- **Fail-fast feedback**: Invalid configs are caught at create/update time, not at first authentication attempt
- **Actionable errors**: Each rule produces a message explaining the constraint and how to fix it
- **No phantom config**: Every persisted field has a runtime effect
- **Zero regression risk**: Pure field-level logic with no database dependencies

## Impact

- **Platform builders**: Get immediate feedback when misconfiguring JIT provisioning fields
- **IdP create/update API**: Six new validation rules enforced on both operations
- **Existing configs**: No impact — all five valid configurations pass validation unchanged

## Related Work

- T01: Proto design (four JIT fields on IdentityProviderSpec)
- T02: FederatedAuthenticationToken + IdentityProviderContext
- T03: Generalized auto-provisioner (SSO + JIT grant logic)
- DD-001: Separate identity and authorization controls
- DD-004: Reject JIT authorization fields on SSO providers

---

**Status**: Production Ready
**Timeline**: Session 4 of JIT provisioning project (April 16, 2026)
