# Expand IdentityAccount gRPC Repo with Query Operations and Dual Authorization

**Date**: March 25, 2026

## Summary

Expanded the `IdentityAccountGrpcRepo` interface with `getByIdpId` and `getByEmail` query operations, implemented them in `IdentityAccountGrpcRepoImpl`, and updated both handlers' custom authorization steps to support a two-tier FGA check: owner-level `can_view` with platform-level `can_manage_identity_accounts` fallback. This enables system/machine account calls via `inProcessChannelAsSystem` while preserving owner-only access for regular users.

## Problem Statement

After removing operator propagation from all FGA types (the OBO impersonation project), the `IdentityAccountGrpcRepo` interface only exposed `create`. System components that needed to look up identity accounts by IDP ID or email went directly to MongoDB, bypassing the standard request pipeline. Meanwhile, the `getByIdpId` and `getByEmail` handlers only checked `can_view` on the specific `identity_account` resource — meaning only the owner could access. This blocked any future system/machine account calls via `inProcessChannelAsSystem`, since the machine account is not the owner of arbitrary identity accounts.

### Pain Points

- **Incomplete gRPC interface** — `IdentityAccountGrpcRepo` only had `create`, forcing callers to bypass the pipeline for reads
- **Owner-only authorization** — `getByIdpId` and `getByEmail` handlers checked `can_view: owner` only, blocking platform operators
- **Authorization inconsistency** — sibling alternate-key lookup RPCs (`getByIdpId`, `getByEmail`) had identical authorization limitations but no path for system-level access
- **Same class of problem as API key hash lookup** — the `ApiKeyGetByKeyHashHandler` authorization failure we fixed earlier was the same pattern: operator removal broke system-level access to resources that only had owner permissions

## Solution

Two-part change:

1. **Interface expansion**: Added `getByIdpId(String)` and `getByEmail(String)` to the `IdentityAccountGrpcRepo` interface, with implementations in `IdentityAccountGrpcRepoImpl` that use `IdentityAccountQueryControllerGrpc` over the system channel.

2. **Dual authorization**: Updated the custom `Authorize` step in both `IdentityAccountGetByIdpIdHandler` and `IdentityAccountGetByEmailHandler` to check two FGA permissions in sequence:
   - First: `can_view` on `identity_account:<id>` (owner access)
   - Fallback: `can_manage_identity_accounts` on `platform:stigmer` (operator access)

## Implementation Details

### Interface Design

The new methods take plain `String` parameters rather than proto wrappers (`IdpId`, `IdentityAccountEmail`). The repo interface is a domain-boundary abstraction — callers (federation provisioner, auth layer) work with strings. Proto wrapping is an implementation detail handled by `IdentityAccountGrpcRepoImpl`.

```java
IdentityAccount getByIdpId(String idpId);
IdentityAccount getByEmail(String email);
```

### Dual Authorization Pattern

The authorization step tries the owner-level check first. Only when that is denied does it fall back to the platform-level check. This means regular self-lookups incur no additional FGA call — the fallback only fires for operator/system calls.

```
Regular user (own account):   can_view on identity_account:<id>  → GRANTED
Machine account (any account): can_view on identity_account:<id>  → DENIED
                               → can_manage_identity_accounts on platform:stigmer → GRANTED
Unauthorized user:             can_view on identity_account:<id>  → DENIED
                               → can_manage_identity_accounts on platform:stigmer → DENIED → PERMISSION_DENIED
```

### Design Decision: Java Dual-Check vs FGA Model Change

The alternative would be to add `can_manage_identity_accounts from platform_ref` to the `identity_account.fga` model. This would require a new `platform_ref` relation and FGA tuples linking every identity account to the platform. The Java dual-check approach was chosen because it is simpler, doesn't require FGA model evolution, and has zero performance impact on the happy path (owner self-lookup).

### Files Changed

| File | Change |
|------|--------|
| `IdentityAccountGrpcRepo.java` | Added `getByIdpId(String)` and `getByEmail(String)` methods, updated Javadoc |
| `IdentityAccountGrpcRepoImpl.java` | Implemented both methods using `IdentityAccountQueryControllerGrpc` stub |
| `IdentityAccountGetByIdpIdHandler.java` | Replaced single `can_view` check with dual authorization (owner + operator fallback) |
| `IdentityAccountGetByEmailHandler.java` | Same dual authorization pattern for consistency |

All authorization steps use `PlatformConstants.PLATFORM_RESOURCE_ID` from the shared constant created in the earlier API key fix.

## Benefits

- **System-level identity lookups via gRPC** — machine account can now look up identity accounts through the standard pipeline with proper authorization
- **Authorization consistency** — both alternate-key lookup RPCs (`getByIdpId`, `getByEmail`) have identical dual-authorization behavior
- **Zero overhead for owner access** — the platform-level fallback only fires when the owner check fails, so normal user self-lookups are unaffected
- **Clean domain boundary** — callers use `String` parameters instead of proto wrappers, keeping the interface at the domain abstraction level

## Impact

- **Affected**: `api-authentication` library interface, `stigmer-service` identity account handlers and downstream gRPC repo
- **Repos**: stigmer-cloud (4 files changed)
- **Risk**: Low — the dual-check is additive (extends existing authorization, doesn't remove any), and the interface expansion is backward-compatible

## Related Work

- **Parent**: OBO impersonation project (20260325.02 + 20260325.03) — operator propagation removal
- **Sibling**: API key hash lookup authorization fix (same session) — established the platform-level authorization fallback pattern
- **Follow-up**: Wiring `IdpIdToIdentityAccountIdCacheProxy` to use the new gRPC methods instead of direct Mongo calls — deferred as a separate decision
- **Parallel**: `IdentityAccountGetHandler` and `IdentityAccountDeleteHandler` authorization gaps — handled separately

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes (planning + implementation)
