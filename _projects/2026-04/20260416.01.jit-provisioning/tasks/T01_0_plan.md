# Task T01: Proto Design and Implementation

**Created**: 2026-04-16
**Status**: PENDING REVIEW
**Type**: Feature Development

## Objective

Add three new fields to `IdentityProviderSpec` for JIT provisioning, plus `tenant_org_claim` for multi-tenant JWT claim mapping. These four fields give platform builders full control over what happens when an unknown JWT arrives.

## Context

Today, federated account creation is either fully manual (platform calls `createFederatedAccount` + creates IAM policies) or fully automatic via SSO (`is_sso_provider = true`). There is no middle ground. Platform builders using React SDK components with their own JWTs hit a wall: they must build backend provisioning flows before a single API call works.

The SSO auto-provisioner (`SsoAutoProvisionerImpl`) already does exactly what these users need, but it's locked behind `is_sso_provider`, which implies the OIDC browser flow. We need to decouple auto-provisioning from the SSO browser flow.

## Design: Four New Fields on IdentityProviderSpec

### Field 1: `auto_provision_accounts` (bool) -- Identity Concern

When a valid JWT arrives but no federated account exists for the `sub` claim, should Stigmer create one?

- `false` (default): Current behavior. Platform must call `createFederatedAccount`.
- `true`: Auto-create the `IdentityAccount` from JWT claims / UserInfo.

This is a pure identity concern. It establishes "Stigmer recognizes this user." It grants no access.

### Field 2: `auto_grant_on_org` (bool) -- Authorization Concern

When an account is auto-provisioned, should Stigmer also grant a role on the IdP's owning organization?

- `false` (default): No org access. Multi-tenant platforms use this.
- `true`: Grant `auto_grant_role` on the IdP's org. Single-org platforms use this.

### Field 3: `auto_grant_role` (IamRole) -- Role Selection

Which role to grant when `auto_grant_on_org = true`. Defaults to `viewer`.

### Field 4: `tenant_org_claim` (string) -- Multi-Tenant JWT Mapping

Name of the JWT claim that identifies the tenant organization. When set:

1. Extract the claim value from the JWT (e.g., `org_id: "tenant-123"`)
2. Look up `platform_managed` org by `(identity_provider_ref, external_org_id = claim_value)`
3. Grant `auto_grant_role` on the resolved tenant org (instead of IdP's org)

This enables fully automated multi-tenant provisioning without any platform backend involvement.

### Validation Invariants

1. `auto_grant_on_org = true` requires `auto_provision_accounts = true`
2. `auto_grant_role` is only meaningful when `auto_grant_on_org = true`
3. `auto_grant_role` cannot be `owner`
4. `is_sso_provider = true` implies `auto_provision_accounts = true` AND `auto_grant_on_org = true`
5. `tenant_org_claim` requires `auto_provision_accounts = true`
6. When `tenant_org_claim` is set, `auto_grant_on_org` controls whether the resolved tenant org gets the role grant

### Five Valid Configurations

| Use Case | Fields | First JWT Behavior |
|---|---|---|
| Full manual control (default) | all false/empty | Reject. Platform manages everything. |
| Single-org, zero friction | `auto_provision = true`, `auto_grant = true` | Auto-create + viewer on IdP org. |
| Multi-tenant, account only | `auto_provision = true`, `auto_grant = false` | Auto-create account. No org access. Platform grants to tenant orgs. |
| Multi-tenant, fully automated | `auto_provision = true`, `auto_grant = true`, `tenant_org_claim = "org_id"` | Auto-create + grant role on resolved tenant org. |
| SSO (unchanged) | `is_sso_provider = true` | Auto-create + viewer + OIDC browser flow. |

## Implementation Plan

### T01: Proto Changes (stigmer repo)

Files to modify:
- `apis/ai/stigmer/iam/identityprovider/v1/spec.proto` -- add four fields (9-12)

```protobuf
bool auto_provision_accounts = 9;
bool auto_grant_on_org = 10;
ai.stigmer.iam.v1.IamRole auto_grant_role = 11;
string tenant_org_claim = 12;
```

Proto comments must document:
- The identity vs authorization separation
- Default behavior (backward compatible: all false)
- SSO implication rules
- Multi-tenant usage patterns
- `tenant_org_claim` resolution algorithm

### T02: Backend -- FederatedAuthenticationToken (stigmer-cloud repo)

Files to modify:
- `FederatedAuthenticationToken.java` -- add `autoProvisionAccounts`, `autoGrantOnOrg`, `autoGrantRole`, `tenantOrgClaim` fields
- `FederatedJwtAuthenticationProvider.java` -- pass new spec fields when constructing the token

### T03: Backend -- Generalize Auto-Provisioner (stigmer-cloud repo)

Files to modify:
- Rename `SsoAutoProvisionerImpl` to `FederatedAutoProvisionerImpl`
- Rename `SsoAutoProvisioner` interface to `FederatedAutoProvisioner`
- Split `provision()` into two explicit steps:
  - `createAccount(...)` -- identity provisioning (always runs)
  - `grantOrgRole(...)` -- authorization (conditional on `autoGrantOnOrg`)
- Add tenant org resolution when `tenantOrgClaim` is set:
  - Extract claim from JWT
  - Look up `platform_managed` org by `(identity_provider_ref, external_org_id)`
  - Grant `autoGrantRole` on resolved org (not IdP org)
  - Handle edge cases: missing claim, org not found, claim present but empty
- Use configured `autoGrantRole` instead of hardcoded `viewer`
- Update `RequestCallerIdentityMapper` interface references

### T04: Backend -- Update Auth Pipeline (stigmer-cloud repo)

Files to modify:
- `RequestCallerIdentityMapper.resolveFederatedIdentity` -- generalize the auto-provision check:

```java
boolean shouldAutoProvision = fedAuth.isSsoProvider() || fedAuth.isAutoProvisionAccounts();
if (shouldAutoProvision && autoProvisioner != null) { ... }
```

### T05: Backend -- IdP Validation (stigmer-cloud repo)

Files to modify:
- `IdentityProviderCreateHandler` / `IdentityProviderUpdateHandler` -- add validation:
  - Reject `auto_grant_on_org = true` when `auto_provision_accounts = false`
  - Reject `auto_grant_role = owner`
  - Reject `tenant_org_claim` when `auto_provision_accounts = false`
  - Warning/rejection when `auto_grant_on_org = true` AND `is_sso_provider = true` (redundant)

### T06: Backend -- Tenant Org Resolution (stigmer-cloud repo)

New component:
- `TenantOrgResolver` -- resolves JWT claim to `platform_managed` org
  - Input: `identity_provider_ref` + claim value (the `external_org_id`)
  - Output: Stigmer org slug
  - Uses existing `OrganizationQueryController.getByExternalOrgId`
  - Error cases: org not found (clear error message), claim missing from JWT

### T07: Testing

- Unit tests for validation invariants (all invalid combinations rejected)
- Unit tests for `FederatedAutoProvisionerImpl` with all five configurations
- Unit tests for `TenantOrgResolver` (happy path, missing claim, org not found)
- Integration test: JWT from IdP with `auto_provision = true` → account auto-created
- Integration test: JWT from IdP with `auto_grant = true` → viewer policy exists
- Integration test: JWT from IdP with `tenant_org_claim` → role granted on tenant org
- Regression test: SSO flow unchanged

### T08: Documentation

Files to modify:
- `docs/guides/federation/provision-federated-accounts.mdx` -- document JIT provisioning as the recommended approach for simple setups, with manual provisioning as the advanced/multi-tenant option
- Update SDK code examples to show `getAccessToken` with platform JWT
- Add a "Quick Start" section showing the 2-step setup (create IdP + enable JIT)

## Open Questions

1. **Rate limiting**: Should auto-provisioning have its own rate limit beyond `rate_limit_budget`? A malicious actor generating JWTs with random `sub` values could create many accounts.

2. **Profile sync**: Should subsequent authentications update profile data (email, name, picture) from the JWT, or only on first creation?

3. **Personal org**: Should auto-provisioned federated accounts get a personal org? Probably not -- platform users don't need a Stigmer personal workspace.

4. **tenant_org_claim edge cases**:
   - What if the JWT has the claim but the `platform_managed` org doesn't exist? Options: reject with 403, reject with specific error, or silently skip the grant.
   - What if a user's JWT contains different tenant claims across requests (user switches tenants)? Should we grant on each new tenant org, or only the first?

## Success Criteria for T01

- [ ] Proto fields added to `IdentityProviderSpec` with complete documentation
- [ ] Proto compiles and SDK types regenerate cleanly
- [ ] Reviewed and approved before proceeding to T02

## Review Process

1. You review this plan
2. Provide feedback on the field design, naming, validation rules, and task breakdown
3. After approval, execution begins with T01 (proto changes)
