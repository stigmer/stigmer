# Fix Machine Account Identity Resolution and FGA Authorization

**Date**: March 22, 2026

## Summary

Fixed a critical bug where the backend service's machine account could not perform privileged operations (like creating organizations during user signup) due to a typo in the bootstrap migration's Auth0 client ID. Also hardened the identity resolution layer to fail loudly when machine account resolution fails, instead of silently degrading into an unresolvable state.

## Problem Statement

After deploying the Auth0 webhook pipeline and triggering user signups, organization creation was failing with `PERMISSION_DENIED: unauthorized to create platform link - operator permission required`. The machine account had the correct FGA operator tuples, but the service was authenticating as a different identity in FGA checks.

### Pain Points

- Organization creation failed silently during the signup flow, leaving users without a default org
- The Temporal workflow (`CreateIdentityAccountFromAuth0Workflow`) was stuck in a retry loop
- The `IdpIdToIdentityAccountIdCacheProxy` silently returned the raw IDP ID when resolution failed, making the root cause extremely hard to diagnose
- The error message (`PERMISSION_DENIED`) pointed to FGA permissions, not to the actual identity mismatch

## Solution

Traced the issue through the full authentication and authorization chain:

1. **JWT validation** → extracts `sub` claim (e.g., `xPOvkIXWCygaRBKfY9BwgzqDkPpLNqwK@clients`)
2. **Identity resolution** → looks up `spec.idpId` in MongoDB → should return internal `ida_*` ID
3. **FGA check** → uses the resolved identity to check operator permission on `platform:stigmer`

Step 2 was failing because the bootstrap migration stored the machine account with a typo in `spec.idpId` — an extra trailing `w` character. The resolution fell back to returning the raw IDP ID, which had no FGA tuples.

## Implementation Details

### Migration Fix (`U20250102_InsertBootstrapIdentityAccounts.java`)

Fixed the `MACHINE_ACCOUNT_CLIENT_ID` constant:
- **Before**: `xPOvkIXWCygaRBKfY9BwgzqDkPpLNqwKw` (33 chars — typo)
- **After**: `xPOvkIXWCygaRBKfY9BwgzqDkPpLNqwK` (32 chars — matches Auth0)

### Identity Resolution Hardening (`IdpIdToIdentityAccountIdCacheProxy.java`)

When `findByIdpId()` returns empty for a machine account (IDP ID ending in `@clients`), the proxy now throws `IdentityAccountNotFoundException` with a descriptive error message pointing to the bootstrap guide, rather than silently returning the raw IDP ID.

Regular user accounts retain the fallback behavior since they may not have an identity account during the initial signup flow.

### New Exception (`IdentityAccountNotFoundException.java`)

Dedicated exception for failed machine account resolution, making it easy to distinguish from other authentication failures in logs and monitoring.

### Bootstrap Guide Update (`04-day0-bootstrap.md`)

Updated stale client ID references from the old `jb5KHA87D2RpkJskuU9xETTllO8IzU2r` to the current `xPOvkIXWCygaRBKfY9BwgzqDkPpLNqwK`.

## Benefits

- Machine account identity resolution now works correctly end-to-end
- Future client ID mismatches will produce a clear, actionable error message instead of a misleading `PERMISSION_DENIED` deep in the FGA check
- Bootstrap guide is accurate and consistent with the migration code
- Reduced debugging time for similar issues from hours to seconds

## Impact

- **Auth0 signup flow**: Organization creation during signup now works correctly
- **Backend service**: All privileged operations using the machine account (webhook processing, IAM policy creation, resource bootstrapping) are unblocked
- **Observability**: Identity resolution failures for machine accounts are now logged at ERROR level with remediation guidance

## Related Work

- Auth0 webhook receiver deployment and payload parsing fixes
- Temporal HTTP API endpoint provisioning for Cloudflare Workers
- FGA bootstrap setup for platform operator permissions

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (diagnosis and fix)
