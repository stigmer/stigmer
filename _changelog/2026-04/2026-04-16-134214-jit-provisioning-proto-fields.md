# JIT Provisioning Proto Fields for IdentityProvider

**Date**: April 16, 2026

## Summary

Added four new fields to `IdentityProviderSpec` that enable Just-In-Time (JIT) provisioning for federated identity providers. These fields decouple auto-provisioning from the SSO browser flow, allowing platform builders to configure zero-friction federation where a platform JWT works end-to-end without any backend provisioning steps.

## Problem Statement

Federated account creation was binary: either fully manual (platform calls `createFederatedAccount` + creates IAM policies) or fully automatic via SSO (`is_sso_provider = true`, which implies the OIDC browser flow). Platform builders using React SDK components with their own JWTs had no middle ground — they had to build backend provisioning flows before a single API call would work.

### Pain Points

- Platform builders embedding Stigmer via SDK had to implement backend provisioning before their first user could authenticate
- The existing SSO auto-provisioner did exactly what these users needed, but was locked behind `is_sso_provider`, which implies the OIDC browser flow
- No support for multi-tenant JWT claim mapping — platforms with tenant organizations had no automated path
- Single-org vs multi-tenant provisioning patterns had no first-class configuration

## Solution

Four new fields on `IdentityProviderSpec` (fields 9-12) that separate identity provisioning from authorization and enable fine-grained control over what happens when an unknown JWT arrives.

## Implementation Details

**File modified**: `apis/ai/stigmer/iam/identityprovider/v1/spec.proto`

### New Fields

| Field | Type | Concern | Purpose |
|-------|------|---------|---------|
| `auto_provision_accounts` (9) | `bool` | Identity | Auto-create `IdentityAccount` from JWT on first auth |
| `auto_grant_on_org` (10) | `bool` | Authorization | Grant role on org after account creation |
| `auto_grant_role` (11) | `IamRole` | Role selection | Which role to grant (default: viewer) |
| `tenant_org_claim` (12) | `string` | Multi-tenant mapping | JWT claim name for tenant org resolution |

### Design Decisions

- **Separate identity and authorization controls** (DD-001): Two independent booleans instead of a single enum or sentinel role value. Each field controls a single, well-defined behavior.
- **IamRole enum type** for `auto_grant_role`: Leverages the existing `ai.stigmer.iam.v1.IamRole` enum rather than introducing a new type.
- **Cross-field validation deferred to service layer**: Business rules (e.g., `auto_grant_on_org` requires `auto_provision_accounts`, `auto_grant_role` cannot be `owner`) are server-side validation, not proto-level constraints.

### Five Valid Configurations

| Use Case | Configuration | Behavior |
|----------|--------------|----------|
| Full manual (default) | All false/empty | Platform manages everything |
| Single-org, zero friction | `auto_provision + auto_grant` | Auto-create + viewer on IdP org |
| Multi-tenant, account only | `auto_provision` only | Auto-create account, no org access |
| Multi-tenant, fully automated | `auto_provision + auto_grant + tenant_org_claim` | Auto-create + role on resolved tenant org |
| SSO (unchanged) | `is_sso_provider = true` | Auto-create + viewer + OIDC browser flow |

### Codegen Propagation

Both codegen pipelines run successfully:
- `make codegen` (stigmer): Proto stubs, Go/TS/Python/Java SDK clients, MCP server types, SDK docs
- `make protos` (stigmer-cloud): Java, Dart, TypeScript, Go, Python stubs via local sibling input

## Benefits

- **Zero-friction onboarding**: Platform builders can enable JIT provisioning with two boolean flags — no backend code required
- **Granular control**: Identity and authorization are independently configurable, supporting both single-org and multi-tenant architectures
- **Backward compatible**: All defaults preserve existing behavior; no breaking changes
- **Multi-tenant automation**: `tenant_org_claim` enables fully automated tenant provisioning from JWT claims

## Impact

- **Proto contract**: New fields on `IdentityProviderSpec` — all SDK types regenerated across Go, TypeScript, Python, Java, Dart
- **Backend (future)**: T02-T06 will implement the runtime behavior for these fields in `stigmer-cloud`
- **Documentation (future)**: T08 will update federation guides to recommend JIT as the default approach

## Related Work

- Design Decision DD-001: Separate Identity and Authorization Controls
- Design Decision DD-002: No Token-from-API-Key Endpoint
- `2026-04-05-104847-remove-jit-provisioning-from-federated-auth.md` — earlier removal of premature JIT logic
- `2026-04-07-165447-sso-auto-provisioning.md` — SSO auto-provisioner that JIT generalizes

---

**Status**: ✅ Production Ready (proto layer complete; backend implementation pending T02-T08)
**Timeline**: T01 of 8-task JIT provisioning project
