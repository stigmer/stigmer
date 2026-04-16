# DD-003: Reject Authentication When Tenant Org Not Found

**Date**: 2026-04-16
**Status**: Approved
**Context**: T03 — Generalize Auto-Provisioner, tenant org resolution behavior

## Decision

When `tenant_org_claim` is configured and `auto_grant_on_org` is true, if the JWT claim value does not resolve to a known platform-managed organization, **reject authentication** with a descriptive, actionable error message. Do not create the account, do not partially succeed.

## Options Considered

### A. Reject authentication (chosen)

Fail-closed. The request is rejected with:
> "No organization found for external_org_id 'tenant-123' under identity provider 'acme/acme-platform'. Create a platform-managed organization with this external_org_id mapped to the identity provider."

### B. Create account, skip org grant (rejected)

The account would be created (identity established) but the org grant would be silently skipped. The user authenticates but has no org access.

**Why rejected**: The platform configured `tenant_org_claim` specifically to say "route this user to their tenant org." Silently skipping that routing turns a configuration error into a partial success. DD-001 separates identity and authorization, but that separation doesn't mean we should succeed at identity when the explicit authorization intent is unfulfillable.

### C. Auto-create the tenant org (rejected)

Stigmer would create the org on the fly using the JWT claim value as the `external_org_id`.

**Why rejected**: A JWT claim value (e.g., "tenant-123") doesn't carry enough information to create a proper organization — no slug, no name, no owner. This inverts the trust hierarchy: users with valid JWTs would control tenant onboarding, not the platform admin.

## Rationale

1. **Consistent with proto contract**: `spec.proto` lines 257-261 already specify rejection
2. **Consistent with existing RPC behavior**: `OrganizationGetByExternalOrgIdHandler` returns `NOT_FOUND` for the same condition
3. **Respects platform intent**: The platform configured multi-tenant routing; if it can't route, it should fail explicitly
4. **Actionable errors**: The error message tells the platform exactly what to do to fix the problem
5. **Security**: Fail-closed prevents unintended access patterns

## Scope

This rejection only applies when ALL conditions are met:
- `tenant_org_claim` is configured (non-empty)
- `auto_grant_on_org` is true
- The JWT contains the claim but the value doesn't resolve to a known org

If `auto_grant_on_org` is false, `tenant_org_claim` is irrelevant — no grant happens, so there's no org to resolve.
