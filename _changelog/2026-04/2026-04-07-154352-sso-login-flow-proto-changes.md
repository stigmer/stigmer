# SSO Login Flow — Proto Changes (Phase 1)

**Date**: April 7, 2026

## Summary

Added the proto definitions and regenerated stubs for the SSO login flow feature: `expected_audience` field on `SsoProviderInfo`, plus two new federated account lifecycle RPCs (`updateFederatedAccount` and `deprovisionFederatedAccount`). This is Phase 1 of the SSO login flow sub-project, unblocking backend handler implementation (Phase 2), SSO auto-provisioning (Phase 3), and web app SSO login (Phase 4).

## Problem Statement

The SSO login flow required three proto-level gaps to be addressed before any backend or frontend implementation could begin:

### Pain Points

- `SsoProviderInfo` (the unauthenticated projection returned by `getSsoProvider`) lacked the `expected_audience` field. Without it, the web app cannot construct OIDC authorization requests for Auth0-based SSO setups, which require an explicit `audience` parameter to issue JWT access tokens.
- Platform backends had no RPC to update profile fields on federated accounts after initial creation. Profile data (email, name, picture) could drift out of sync between the platform and Stigmer.
- Platform backends had no RPC to deprovision federated accounts during user offboarding. The only option was the low-level `delete` RPC, which requires Stigmer's internal account ID rather than the natural key the platform knows (`identity_provider_ref` + `external_sub`).

## Solution

Three proto changes in the `stigmer` repo's `apis/` directory, followed by full stub regeneration across all four languages (Go, Java, Python, TypeScript) and SDK codegen.

## Implementation Details

### 1. `SsoProviderInfo.expected_audience` (field 4)

**File**: `apis/ai/stigmer/iam/identityprovider/v1/io.proto`

Added `string expected_audience = 4` to the `SsoProviderInfo` message. The web app passes this as the `audience` parameter when initiating the OIDC Authorization Code flow. For IdPs that determine audience from server-side config (Okta, Entra ID), an empty value tells the web app to omit the parameter.

### 2. `updateFederatedAccount` RPC

**Files**: `apis/ai/stigmer/iam/identityaccount/v1/io.proto`, `command.proto`

New `UpdateFederatedAccountInput` message with the standard natural-key triple (`org`, `identity_provider_ref`, `external_sub`) plus profile fields (`email`, `first_name`, `last_name`, `picture_url`). Uses full-replace semantics matching `CreateFederatedAccountInput`. Authorization: `can_create_identity_account` on the organization, consistent with the existing `createFederatedAccount` and `getByExternalSub` RPCs.

### 3. `deprovisionFederatedAccount` RPC

**Files**: `apis/ai/stigmer/iam/identityaccount/v1/io.proto`, `command.proto`

New `DeprovisionFederatedAccountInput` message with the natural-key triple plus a `delete_account` boolean. Two modes: revoke-only (remove IAM policies, preserve account for audit) and revoke-and-delete (full cleanup). Same authorization as above.

### Stub Regeneration

`make protos` regenerated stubs across: Go (`apis/stubs/go`, `sdk/go/proto`, `mcp-server/proto`), Java (`apis/stubs/java`), Python (`apis/stubs/python`), TypeScript (`apis/stubs/ts`), plus SDK client codegen for all four language SDKs.

## Benefits

- Unblocks Phase 2 (backend lifecycle handlers), Phase 3 (SSO auto-provisioning), Phase 4 (web app SSO login page), and Phase 5 (SSO URL on IdP detail panel)
- Platform builders get a complete federated account lifecycle: create, update, deprovision — all via natural-key interface without needing to track Stigmer's internal IDs
- The `expected_audience` field closes the gap for Auth0-based SSO configurations while remaining benign for other IdP types

## Impact

- **Proto API surface**: 2 new RPCs, 2 new messages, 1 new field — additive, no breaking changes
- **Generated stubs**: 38 files updated across Go, Java, Python, TypeScript
- **SDK clients**: All four language SDKs now expose `updateFederatedAccount` and `deprovisionFederatedAccount` methods
- **No backend changes yet**: Handlers will be implemented in Phase 2

## Related Work

- Parent project: `20260405.02.identity-provider-flow` (Phases 1-8 completed)
- Sub-project: `20260407.01.sp.sso-login-flow` (Phase 1 of 6 complete)
- Design decision: `001-sso-auto-provisioning-viewer-role` (SSO auto-provisioned accounts get viewer role, not member)

---

**Status**: Production Ready (proto definitions; backend handlers pending Phase 2)
