# Identity Provider Federation Hardening

**Date**: April 7, 2026

## Summary

Closed two production-readiness gaps in the Identity Provider federation layer: enforced global issuer uniqueness at write time (preventing non-deterministic JWT routing) and wired cache invalidation into all IdP mutation pipelines (eliminating up to 5-minute stale windows after configuration changes).

## Problem Statement

The Identity Provider federation layer had two gaps between its documentation ("this should be prevented at creation time") and its actual behavior:

### Pain Points

- **Silent misrouting risk**: If two IdPs across different orgs registered the same `allowed_issuers` entry, the in-memory issuer cache would non-deterministically pick one. The cache logged a warning but nothing prevented the conflict at write time.
- **Stale cache after mutations**: Creating, updating, or deleting an IdP had no effect on the authentication layer for up to 5 minutes (the cache TTL). `IdentityProviderIssuerCache.invalidate()` and `FederatedJwtDecoderCache.evict()` existed but were never called from any handler.

## Solution

Defense-in-depth approach: application-level validation for clear error messages, a MongoDB unique index for race condition protection, and synchronous cache invalidation wired into all mutation pipelines.

## Implementation Details

### New pipeline step: `ValidateIssuerUniqueness`

Shared across create and update handlers (typed to `ContextBase<IdentityProvider, IdentityProvider>`). For each issuer in the request, queries MongoDB to check whether any other IdP document already claims it. On update, excludes the current document by `metadata.id`. Returns `ALREADY_EXISTS` with the specific conflicting issuer string in the error message.

### New pipeline step: `InvalidateFederationCaches`

Calls `issuerCache.invalidate()` + `decoderCache.evictAll()` after successful persistence. Best-effort: catches exceptions and always returns success so cache issues never block a mutation. A separate inner class `InvalidateCachesOnDelete` handles the delete handler's different context type.

### MongoDB migration: `U20260407_IssuerUniquenessIndex`

Unique multikey index on `spec.allowedIssuers` with partial filter `{ "spec.allowedIssuers.0": { $exists: true } }`. Catches race conditions between application validation and persist. Mongock order `"011"`.

### Handler pipeline changes

- **Create**: `validateIssuerUniqueness` after `validateSsoFields`; `invalidateFederationCaches` after `createAuthorizationTuples`
- **Update**: `validateIssuerUniqueness` after `validateSsoFields`; `invalidateFederationCaches` after `persist`
- **Delete**: `invalidateCachesOnDelete` after `cleanupIamPolicies`

## Benefits

- JWT-to-IdP routing is now deterministic: duplicate issuers are rejected at write time with a clear error message
- IdP configuration changes take effect immediately instead of after a 5-minute TTL window
- Database-level unique index provides protection against race conditions and direct DB manipulation
- Follows the established `ValidateSsoFields` pattern for consistency across the handler codebase

## Impact

- **IdentityProvider create/update/delete handlers** in stigmer-cloud: all three pipelines modified
- **Authentication flow**: no changes to the hot path; only the admin-facing write path is affected
- **Existing IdP data**: the migration creates a unique index; any pre-existing duplicate issuers would block the migration (none exist in production)

## Related Work

- Part of the identity-provider-flow project (`_projects/2026-04/20260405.02.identity-provider-flow`)
- Builds on the federation layer from Phases 1-8 (email uniqueness fix, JIT removal, createFederatedAccount RPC, SSO data model, secure lookups, SDK, web app, documentation)

---

**Status**: Production Ready
**Timeline**: Single session
