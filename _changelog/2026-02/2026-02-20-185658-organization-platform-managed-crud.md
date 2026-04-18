# Organization CRUD: Platform-Managed Organization Support

**Date**: February 20, 2026

## Summary

Extended the Organization resource with full backend enforcement for platform-managed organizations. Added validation, custom authorization, immutability enforcement, and a new `getByExternalOrgId` query RPC — enabling external platforms like Planton to programmatically create and look up Stigmer organizations via their IdentityProvider trust relationship.

## Problem Statement

The Organization proto already had `management_mode`, `identity_provider_ref`, and `external_org_id` fields defined, but the backend handlers stored them as-is with zero enforcement. This meant:

### Pain Points

- Any user could create a `platform_managed` organization without proving they control the IdentityProvider
- No cross-validation between management_mode and its companion fields (identity_provider_ref, external_org_id)
- Update requests could silently overwrite immutable creation-time fields due to proto3 default-value behavior
- No way for external platforms to look up a Stigmer organization by their own platform org ID
- No uniqueness guarantee on external_org_id within an IdentityProvider scope

## Solution

Implemented comprehensive CRUD enforcement through pipeline steps in the existing handler framework, plus a new query RPC for platform-initiated org lookups.

## Implementation Details

### Proto Changes (stigmer repo)

- **`io.proto`**: Added `OrganizationExternalLookup` message with `identity_provider_ref` (required) and `external_org_id` (min 1 char), with buf.validate constraints
- **`query.proto`**: Added `getByExternalOrgId` RPC to `OrganizationQueryController` with `is_skip_authorization = true` (custom handler auth)
- Regenerated Go stubs

### Create Handler (stigmer-cloud)

Four new pipeline steps added to `OrganizationCreateHandler`:

1. **ValidateManagementModeFields** — Cross-validates management_mode against identity_provider_ref and external_org_id. self_managed orgs must not have IdP or external org fields; platform_managed orgs must have both.
2. **ValidateAndAuthorizeIdentityProvider** — For platform_managed: verifies the referenced IdentityProvider exists (cross-domain MongoTemplate query) and checks `can_edit` permission via FGA. Follows the `CheckNoReferencingOrgs` cross-domain guard pattern.
3. **ValidateExternalOrgIdUnique** — Prevents duplicate external_org_id per IdentityProvider scope.
4. **NormalizeManagementMode** — Sets proto3 default `unspecified` to `self_managed` in persisted state.

### Update Handler (stigmer-cloud)

One new pipeline step added to `OrganizationUpdateHandler`:

- **EnforceImmutableFields** — Placed after `buildNewState`. Two responsibilities: (1) rejects explicit attempts to change management_mode, identity_provider_ref, or external_org_id with clear INVALID_ARGUMENT errors; (2) always copies these fields from the existing resource into the new state, preventing proto3 default-value zeroing.

### New Query Handler (stigmer-cloud)

- **OrganizationGetByExternalOrgIdHandler** — Looks up a platform-managed org by IdentityProvider reference + external org ID. Custom authorization checks `can_view` on the referenced IdentityProvider (since the caller doesn't know the Stigmer org ID yet).
- **OrganizationRepo.findByExternalOrgId** — Compound MongoDB query on `spec.identityProviderRef.org`, `spec.identityProviderRef.slug`, and `spec.externalOrgId`.

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Create authz for platform_managed | `can_edit` on IdentityProvider | Prevents unauthorized users from tying orgs to a platform |
| external_org_id uniqueness | Scoped to IdentityProvider | Different platforms may have overlapping org IDs |
| Immutability enforcement | Reject + preserve from existing | Explicit errors for intentional changes; silent fix for proto3 defaults |
| getByExternalOrgId authz | `can_view` on IdentityProvider | Caller doesn't know org ID; IdP access is sufficient |
| Cross-domain queries | MongoTemplate direct | Follows existing CheckNoReferencingOrgs pattern |

## Benefits

- Platform-managed organizations are now properly guarded by authorization and validation
- Immutable fields cannot be corrupted by update requests (including the proto3 default-value edge case)
- External platforms have a clean lookup RPC to find their mapped Stigmer organizations
- All enforcement follows established codebase patterns (pipeline steps, cross-domain MongoTemplate guards, custom FGA authorization)

## Impact

- **Organization domain**: Create, update, and query handlers all enhanced
- **IdentityProvider domain**: Delete handler's `CheckNoReferencingOrgs` pattern now has a symmetric counterpart in the Organization create handler
- **Platform integration**: Planton (and any future platform) can now create and look up organizations through a well-defined, authorized flow

## Related Work

- IdentityProvider CRUD (session 4) — the trust anchor that platform-managed orgs reference
- Federated auth interceptor (session 6) — authenticates platform users via their IdentityProvider's JWKS
- Federation refactoring (session 6 follow-up) — domain boundary cleanup for JIT identity provisioning

---

**Status**: Production Ready
**Timeline**: Single session (Session 7)
