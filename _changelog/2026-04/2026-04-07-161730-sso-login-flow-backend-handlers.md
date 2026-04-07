# SSO Login Flow — Backend Lifecycle RPC Handlers

**Date**: April 7, 2026

## Summary

Implemented Phase 2 of the SSO login flow sub-project: backend handlers for `updateFederatedAccount` and `deprovisionFederatedAccount` RPCs, plus the cross-domain `revokeOrgAccess` interface extension. All proto stubs from Phase 1 were already generated; this session wired up the Java backend handlers that implement the RPC contracts.

## Problem Statement

Phase 1 defined the proto messages and RPC signatures for federated account lifecycle management, but the backend had no handlers to serve them. Platform backends calling `updateFederatedAccount` or `deprovisionFederatedAccount` would get an UNIMPLEMENTED gRPC status.

### Pain Points

- No way for platform backends to update a federated user's profile (email, name, picture) after initial creation
- No way to offboard a federated user (revoke access or delete account) through the API
- The `revokeOrgAccess` RPC existed as an IAM Policy handler but was not accessible from the Identity Account domain (no cross-domain interface)

## Solution

Two new `CustomOperationHandlerV2` handlers following the established pipeline pattern, plus a cross-domain interface extension for org access revocation.

## Implementation Details

### UpdateFederatedAccountHandler

Pipeline: `validateFieldConstraints` → `authorize` → `validateIdentityProvider` → `lookupByExternalSub` → `updateProfileFields` → `transformResponse` → `sendResponse`

- Natural-key lookup via `findByIdentityProviderRefAndIdpId(org, slug, externalSub)`
- Full-replace semantics for profile fields (email, firstName, lastName, pictureUrl)
- Updates `metadata.name` to track email changes (name = email for federated accounts)
- Direct `IdentityAccountRepo.save()` instead of standard update pipeline — authorization model mismatch (org-level `can_create_identity_account` vs account-level `can_edit`)

### DeprovisionFederatedAccountHandler

Pipeline: `validateFieldConstraints` → `authorize` → `validateIdentityProvider` → `lookupByExternalSub` → `revokeOrgAccess` → `deleteAccount` (conditional) → `cleanupCache` → `sendResponse`

- `RevokeOrgAccess` step delegates to `IamPolicyGrpcRepo.revokeOrgAccess()` via cross-domain in-process gRPC with system credentials
- `DeleteAccount` step uses `shouldExecute()` guard — only runs when `delete_account = true`; deletes from MongoDB then cleans up all FGA tuples via `cleanupResourcePolicies`
- `CleanupCache` step clears the stale Redis federation resolver cache entry (best-effort, no failure on error)
- Returns the deprovisioned `IdentityAccount` for audit trail

### IamPolicyGrpcRepo.revokeOrgAccess

- Added to the shared `IamPolicyGrpcRepo` interface in `api-authorization` lib
- Implemented in `IamPolicyGrpcRepoImpl` using `iamChannelAsSystem` (system credentials)
- Follows the same cross-domain pattern as `createPolicy`, `bootstrapPolicy`, `cleanupResourcePolicies`, `deletePolicy`

### IdentityProviderGetSsoProviderHandler

- Populated `expectedAudience` field from `spec.expectedAudience` in the MongoDB document (discovered this was already done in Phase 1)

## Benefits

- Platform backends can now manage the full federated account lifecycle: create → update → deprovision
- Clean offboarding: revoke-only mode preserves accounts for audit, delete mode does full cleanup
- Redis cache cleanup prevents stale auth resolution after deprovision
- Cross-domain `revokeOrgAccess` is now a first-class interface method, reusable by Phase 3 (SSO auto-provisioning)

## Impact

- **Platform backends**: Can now call `updateFederatedAccount` and `deprovisionFederatedAccount` RPCs
- **Identity Account domain**: Two new handlers, direct repo update pattern for federation-specific authorization
- **IAM Policy domain**: New cross-domain interface method for org access revocation
- **Codebase patterns**: Established the "direct repo save with org-level authorization" pattern for federation handlers that don't fit the standard CRUD pipeline

## Related Work

- Phase 1 (proto changes): `865e6c64 feat(apis): add federated account lifecycle RPCs and SsoProviderInfo audience field`
- Phase 3 (next): SSO auto-provisioning in `FederatedIdentityResolverImpl`
- Parent project: `20260405.02.identity-provider-flow`
- Design decision: `001-sso-auto-provisioning-viewer-role.md`

---

**Status**: Production Ready (pending commit on `feat/sso-login-flow` branch)
**Timeline**: 1 session
