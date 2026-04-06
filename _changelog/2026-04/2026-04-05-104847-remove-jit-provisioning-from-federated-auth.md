# Remove JIT Provisioning from Federated Authentication

**Date**: April 5, 2026

## Summary

Removed Just-In-Time (JIT) account provisioning from the federated authentication flow and replaced it with a resolve-only pattern. Federated identity accounts must now be explicitly created by the platform before users can authenticate. This is Phase 2 of the identity provider flow project, following the MongoDB email uniqueness fix (Phase 1).

## Problem Statement

The JIT provisioning model was fundamentally broken for federated identity accounts. When a user authenticated via an external identity provider, Stigmer would auto-create an identity account on the fly — but that account had zero permissions. The platform had no way to learn the account ID from JIT, so it couldn't grant roles. This created a chicken-and-egg problem: users could authenticate but couldn't access anything.

### Pain Points

- JIT-created accounts had no permissions — authentication succeeded but authorization always failed
- Platforms couldn't learn the identity account ID to grant roles before the user's first login
- The compound `idp_id` format (`federated:{providerId}:{sub}`) leaked internal resource IDs into the identity field
- `UserInfoClient` was called on every authentication to fetch profile data — unnecessary overhead for returning users
- The provisioner interface mixed two concerns: account lookup (read) and account creation (write)

## Solution

Replaced the JIT provisioning flow with a clean resolve-only pattern. The platform explicitly creates federated accounts via API, gets back the account ID, grants roles, and only then can the user authenticate successfully.

The authentication flow now: validate JWT -> extract raw `sub` claim -> look up account by `(identity_provider_ref, idp_id)` -> if not found, return 401 with a clear message telling the platform to create the account first.

## Implementation Details

### Interface Rename: Provisioner -> Resolver

Renamed `FederatedIdentityProvisioner` to `FederatedIdentityResolver` with a fundamentally different contract:

- **Before**: `String resolveOrProvision(compoundIdpId, idpId, org, slug, userInfoEndpoint, accessToken)` — always returns an account ID (creates if needed)
- **After**: `Optional<String> resolve(externalSub, org, slug)` — returns empty if account doesn't exist

The `Optional` return type pushes the policy decision (what to do when not found) to the caller (`RequestCallerIdentityMapper`), keeping the resolver as a pure lookup.

### Compound Key Elimination

Removed the `federated:{providerId}:{sub}` compound key format entirely:

- Deleted `buildCompoundIdpId()` and `FEDERATED_IDP_ID_PREFIX` from `AuthenticationTokenParser`
- `parseId()` for federated tokens now returns the raw JWT `sub` claim
- Identity uniqueness is enforced by the pair `(identity_provider_ref, idp_id)` rather than a single compound field
- Added `findByIdentityProviderRefAndIdpId(org, slug, idpId)` to `IdentityAccountRepo` for compound lookups

### Token Simplification

Removed `userInfoEndpoint` from `FederatedAuthenticationToken`. This field only served JIT provisioning — carrying the UserInfo URL to avoid a second IdentityProvider lookup during account creation. With provisioning removed, the token now carries only what's needed for identity resolution.

### Documentation Overhaul

Updated all proto comments and 7 documentation files to reflect the new explicit-creation model. Removed all references to JIT provisioning, compound keys, and automatic account creation.

## Benefits

- **Correct authorization model**: Platforms create accounts and grant roles before authentication, so users have permissions from their first login
- **Simpler auth flow**: No write operations during authentication — pure read path
- **Cleaner data model**: Raw OIDC `sub` stored in `idp_id`, scoped by `identity_provider_ref`
- **Reduced auth latency**: No UserInfo HTTP call or gRPC account creation during authentication
- **Clear error messages**: 401 tells the platform exactly what to do ("create the account first")

## Impact

- **Backend**: 3 files created, 3 deleted, 11 edited across `api-authentication` lib and `stigmer-service`
- **Proto**: 4 proto source files updated (comments only — no schema changes), stubs regenerated
- **Docs**: 7 markdown files rewritten to describe the new explicit-creation flow
- **Tests**: 3 test files rewritten/updated to match new behavior
- **Breaking**: Federated authentication now returns 401 if the account doesn't exist (previously JIT-created). No production impact since no federated account data exists.

## Related Work

- Phase 1: Fix MongoDB email uniqueness (`2026-04-05-100716-fix-email-uniqueness-index-for-federation.md`)
- Phase 3 (next): New `createFederatedAccount` RPC with proper authorization
- IAM role/permission separation (`2026-04-05-101218-iam-role-permission-separation-and-package-relocation.md`)

---

**Status**: Production Ready
**Timeline**: Single session (~2 hours)
