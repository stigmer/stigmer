# Secure Identity Account Lookups

**Date**: April 5, 2026

## Summary

Fixed critical security and correctness issues in identity account lookup RPCs that were introduced by the Phase 1 email uniqueness removal. Added a new `getByExternalSub` query RPC for safe federated account lookups, scoped `getByEmail` to direct accounts only, eliminated a broken Auth0 API indirection in `getByIdpId`, and cleaned up dead email-based cache proxies.

## Problem Statement

After removing the unique email index in Phase 1 (to allow direct and federated accounts to share emails), several lookup paths became broken or unsafe:

### Pain Points

- `getByIdpId` handler called Auth0 Management API to get email, then used `findByEmail` to find the account — with email no longer unique, this returned an arbitrary account (potentially the wrong one)
- `getByEmail` RPC could return a federated account from a different trust boundary when a direct and federated user shared the same email
- No IdP-scoped lookup existed for platforms to check if a federated account already existed before calling `createFederatedAccount`
- Two email-based cache proxy classes (`EmailToIdentityAccountIdCacheProxy`, `EmailToIdpIdCacheProxy`) were dead code with zero callers
- Auth0 Temporal activity duplicate-key fallback used `getByEmail` which could return the wrong account

## Solution

Five targeted fixes that make identity account lookups correct and secure in a world where email is no longer unique:

1. **`getByIdpId` handler**: Replace Auth0 -> email -> findByEmail indirection with direct `findByIdpId` lookup
2. **`getByEmail` / `findByEmail`**: Add filter to exclude federated accounts (only return direct/machine accounts)
3. **New `getByExternalSub` RPC**: IdP-scoped federated account lookup by `identity_provider_ref` + `external_sub`
4. **Auth0 Temporal fallback**: Change duplicate-key recovery from `getByEmail` to `getByIdpId`
5. **Dead code removal**: Delete `EmailToIdentityAccountIdCacheProxy`, `EmailToIdpIdCacheProxy`, and associated Redis methods

## Implementation Details

### getByIdpId handler rewrite

Rewrote `IdentityAccountGetByIdpIdHandler.java` from a 6-step pipeline (with Auth0 API call, placeholder user creation for machine accounts, email-based DB lookup, entity-to-proto conversion) to a clean 4-step pipeline: validate -> loadByIdpId -> authorize -> transformResponse. This eliminates an external API call to Auth0 on every lookup.

### getByEmail scoped to direct accounts

Modified `findByEmail` and `findByIdOrEmail` in `IdentityAccountRepo.java` to add `.and("spec.identityProviderRef.org").exists(false)`. Since federated accounts have an `identityProviderRef` and direct/machine accounts don't, this cleanly separates the two account types without needing to check `provisioning_mode`.

### New getByExternalSub RPC

- Proto: `ExternalSubLookup` message with `org` (auth scope), `identity_provider_ref`, and `external_sub`
- Query RPC authorized with `can_create_identity_account` on organization (same permission as `createFederatedAccount`)
- Handler: `IdentityAccountGetByExternalSubHandler.java` with org-level `commonSteps.authorize` and existing `findByIdentityProviderRefAndIdpId` compound lookup

### Cleanup

- Removed `EmailToIdentityAccountIdCacheProxy.java` and `EmailToIdpIdCacheProxy.java` (zero callers anywhere in codebase)
- Removed 4 Redis cache methods and 2 constants that only served these dead proxies

## Benefits

- **Correctness**: `getByIdpId` no longer returns wrong accounts when emails collide
- **Security**: `getByEmail` cannot leak federated accounts across trust boundaries
- **Performance**: `getByIdpId` no longer calls Auth0 Management API on every request
- **API completeness**: Platforms have a dedicated `getByExternalSub` for federated account existence checks
- **Code hygiene**: Removed 2 dead classes + 4 dead Redis methods

## Impact

- **Platform backends**: Can now safely check federated account existence via `getByExternalSub` before creating accounts
- **Auth flow**: `getByIdpId` path (used during Auth0 token resolution) is faster and correct
- **SDK consumers**: New `getByExternalSub` available in all SDKs (TypeScript, Python, Go, Java)
- **No breaking API changes**: `getByEmail` signature unchanged (behavioral change: federated accounts excluded)

## Related Work

- Phase 1: Fix MongoDB email uniqueness (prerequisite — removed unique email index)
- Phase 3: createFederatedAccount RPC (provides the `can_create_identity_account` permission reused here)

---

**Status**: Production Ready
**Repos**: stigmer (proto + SDKs), stigmer-cloud (backend)
