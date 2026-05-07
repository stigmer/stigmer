# JWT Signing Key Provisioning for PlatformClient Tokens

**Date**: May 7, 2026

## Summary

Provisioned the RSA signing key infrastructure required for Stigmer-issued JWTs. The `StigmerJwtKeySource` component was already implemented but had no key material configured in any environment, causing the service to boot with JWT signing/verification disabled.

## Problem Statement

The stigmer-service was logging warnings on every startup:
- "Stigmer JWT signing key not configured — mintUserToken and PlatformClient token validation will be unavailable"
- "Stigmer JWT verifier not configured — PlatformClient token validation will be unavailable"

### Pain Points

- `mintUserToken` RPC non-functional in all environments (local, prod)
- PlatformClient SDK token refresh cycle broken
- The `STIGMER_JWT_SIGNING_KEY` env var was referenced in `application.yaml` but never declared in Kustomize or provisioned in Planton

## Solution

End-to-end provisioning of the JWT signing key:
1. Generated a 2048-bit RSA private key (PKCS#8 DER, Base64-encoded)
2. Created a Planton secrets-group (`stigmer-jwt`) to hold the key
3. Wired the secret into the prod Kustomize overlay so it flows to all environments that inherit from prod (including local via `planton service dot-env`)

## Implementation Details

- **Key generation**: `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -outform DER | base64`
- **Secrets-group**: `_ops/planton/service-hub/secrets-group/stigmer-jwt.yaml` with entry `prod.signing-key`
- **Kustomize wiring**: Added to `_kustomize/overlays/prod/service.yaml` (not base) as `$secrets-group/stigmer-jwt/prod.signing-key` — environment-specific secrets belong in overlays, not base
- **Local dev**: `planton service dot-env --env local` now resolves and injects the key automatically

## Benefits

- `mintUserToken` RPC is now functional — React SDK can obtain short-lived user tokens
- PlatformClient token validation active in the auth chain
- No more noisy WARN logs on every startup
- Clean separation: future `dev`/`test` overlays can reference their own entry (e.g., `dev.signing-key`)

## Impact

- **PlatformClient SDK users**: Can now authenticate via Stigmer-issued JWTs
- **Local development**: Warning eliminated, full auth chain testable locally
- **Production**: JWT signing enabled once this branch deploys

## Related Work

- `StigmerJwtKeySource`, `StigmerJwtIssuer`, `StigmerJwtVerifier` (api-authentication lib)
- Billing execution auth chain (uses PlatformClient tokens)
- React SDK `mintUserToken` refresh cycle

---

**Status**: ✅ Production Ready
**Timeline**: Single session
