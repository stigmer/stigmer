# DD-004: Reject JIT Authorization Fields on SSO Providers

**Date**: 2026-04-16
**Status**: Approved
**Context**: T05 — IdP JIT Field Validation

## Decision

When `is_sso_provider = true`, the JIT authorization fields (`auto_grant_on_org`, `auto_grant_role`, `tenant_org_claim`) must be empty/default. Setting them returns `INVALID_ARGUMENT` at write time.

`auto_provision_accounts` is allowed with SSO — it's redundant (SSO implies it) but not misleading.

## Options Considered

### A. Reject JIT authorization fields on SSO providers (chosen)

Fail at write time with a clear error message directing the user to use JIT provisioning instead of SSO for customizable behavior.

### B. Accept silently, ignore at runtime (rejected)

The fields would be stored but have no runtime effect. SSO always grants viewer on IdP's org regardless of JIT field values (per T03's `sso_ignoresJitFields` architectural invariant).

**Why rejected**: Creates phantom configuration. A user who sets `auto_grant_role = member` alongside `is_sso_provider = true` reasonably expects SSO users to get member. They'd configure it, test it, and be confused when SSO users always get viewer. A world-class platform should not store configuration that has no effect.

## Rationale

1. **No phantom config**: Every persisted field should have a runtime effect
2. **Prevents debugging traps**: Users won't waste time wondering why JIT fields "don't work" with SSO
3. **Separate trust models**: SSO (OIDC browser flow + fixed viewer grant) and JIT (API-based + configurable grants) are architecturally distinct modes. Allowing both on the same IdP suggests they compose, but they don't
4. **Actionable error**: The error message explains the constraint and gives a clear alternative
5. **Migration-safe**: A user switching from SSO to JIT can turn off SSO and set JIT fields in the same update request

## Scope

Only the three authorization-layer fields are rejected:
- `auto_grant_on_org` (authorization concern)
- `auto_grant_role` (role selection)
- `tenant_org_claim` (multi-tenant routing)

`auto_provision_accounts` is NOT rejected with SSO — it's the identity concern, and SSO already implies it per the proto documentation.
