# Fix Federated IdentityProvider JWT Rejection

**Date**: April 15, 2026

## Summary

Fixed a production bug where SSO authentication via federated IdentityProviders failed with an opaque "invalid token" error, even though the JWT was completely valid. The root cause was that `SsoAutoProvisionerImpl` read profile claims directly from the JWT, but Auth0 access tokens do not include OIDC profile claims — the UserInfo endpoint (already configured in the IdP spec) was never called. A secondary bug caused the catch-all gRPC interceptor to mask post-auth identity resolution failures as authentication failures.

## Problem Statement

Users configuring federated IdentityProviders with Auth0 (and other OIDC providers) could not authenticate through the `@stigmer/react` SDK. Every request was rejected with `invalid token`, making it impossible to self-diagnose.

### Pain Points

- Auth0 access tokens for API audiences do not include OIDC profile claims (`email`, `name`, `picture`) — they are only available via the UserInfo endpoint
- The SSO auto-provisioner required `email` from the JWT and threw `SsoAutoProvisioningException` when it was absent
- The gRPC auth interceptor's catch-all caught downstream identity resolution exceptions and reported them as `UNAUTHENTICATED "invalid token"`
- Platform builders had zero ability to self-diagnose — the real cause was only in server logs
- No issuer URL normalization meant trailing-slash mismatches could cause silent failures
- No JWKS URI validation at IdentityProvider creation time meant misconfigurations were only discovered at first auth attempt

## Solution

Four-phase fix addressing the root cause, error masking, SDK developer experience, and configuration robustness.

## Implementation Details

### Phase 1: OIDC-Compliant Profile Resolution

Refactored `SsoAutoProvisionerImpl` to implement the standard OIDC two-step profile resolution:

1. **JWT claims first** (zero-cost optimization for IdPs that include them)
2. **UserInfo endpoint** when claims are absent (the OIDC-standard path per Section 5.3)
3. **Actionable error** only when both sources yield no email

Enhanced `UserInfoClient` with proper exception-based error handling: HTTP 401/403 → scope hint, network failure → reachability message, missing email → configuration guidance.

### Phase 2: Proper Error Ownership in Interceptor Chain

Narrowed the `GrpcSecurityConfigBase.authInterceptor` catch scope to wrap only `authManager.authenticate()`. Made `GrpcRequestContextBuilderInterceptor` handle its own exceptions with typed exception handling:

- `IdentityAccountNotFoundException` → UNAUTHENTICATED with account creation guidance
- `SsoAutoProvisioningException` → UNAUTHENTICATED with cause-specific message
- Generic exceptions → INTERNAL with generic message

Added `classifyAuthError()` for actionable auth error descriptions (audience mismatch, expired token, signature failure).

### Phase 3: SDK Error Message Enrichment

Added `AUTH_ERROR_PATTERNS` to `sdk/typescript/src/errors.ts` that maps enriched gRPC status descriptions to developer-friendly guidance, covering audience mismatch, signature failure, expired tokens, missing accounts, and provisioning failures.

### Phase 4: Issuer Normalization + JWKS Validation

- `IssuerUrlNormalizer`: RFC 3986 normalization (trim, strip trailing slashes, lowercase scheme+host)
- `NormalizeIssuerUrls` pipeline step: normalizes `allowed_issuers` at write time before uniqueness validation
- `ValidateJwksReachability` pipeline step: validates JWKS URI reachability, HTTP 200, valid JWKS structure at IdentityProvider create/update time
- Applied normalization in `IdentityProviderIssuerCache` at both lookup and reload time

## Benefits

- SSO authentication via Auth0 (and other OIDC providers) now works out of the box
- Platform builders see actionable error messages instead of opaque "invalid token"
- Issuer URL trailing-slash mismatches no longer cause silent authentication failures
- Misconfigured JWKS URIs are caught at IdentityProvider creation time, not at first auth attempt
- SDK surfaces developer-friendly guidance for all federated auth error conditions

## Impact

- **Platform builders**: Federated IdentityProvider setup with Auth0 and other OIDC providers now works as documented
- **Stigmer SSO users**: The Planton backstage Auth0 SSO IdP (currently the only IdP in production) will work for Google OAuth2 social login users
- **SDK consumers**: Auth error messages now explain what to do, not just what failed

## Related Work

- GitHub Issue: [stigmer/stigmer#123](https://github.com/stigmer/stigmer/issues/123)
- IdentityProvider proto spec: `apis/ai/stigmer/iam/identityprovider/v1/spec.proto`
- UserInfo endpoint was already defined in the IdentityProvider spec but never used

---

**Status**: Production Ready
**Timeline**: Investigation + implementation in single session
