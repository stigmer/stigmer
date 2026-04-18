# Federated Authentication via Auth Interceptor Extension

**Date**: February 20, 2026

## Summary

Implemented end-to-end federated authentication for Stigmer, enabling external platforms (like Planton) to call Stigmer's gRPC APIs using their own JWTs without a token exchange proxy. The solution validates external JWTs directly in the auth interceptor, performs JIT identity provisioning via OIDC UserInfo, and constructs compound IDP identifiers to maintain global uniqueness across identity providers.

## Problem Statement

Stigmer needed a mechanism for external platforms to authenticate their users against Stigmer's APIs without requiring those users to create Stigmer Auth0 accounts. The initial design proposed a token exchange endpoint (RFC 8693) and a proxy SDK, but analysis revealed these were unnecessary complexity.

### Pain Points

- External platform users had no way to access Stigmer APIs
- Token exchange endpoints add latency, operational complexity, and a single point of failure
- A proxy SDK forces integrators to deploy additional infrastructure
- Self-signed JWTs duplicate what the external platform's Auth0 already provides
- The "confused deputy" concern was addressed by explicit `IdentityProvider` configuration acting as the trust boundary

## Solution

Direct JWT validation in Stigmer's Spring Security auth chain, backed by per-IdentityProvider JWKS caches and JIT identity provisioning. External platforms call Stigmer APIs directly — no proxy, no token exchange, no additional infrastructure.

The architecture:
```
External Platform User → Platform Backend (platform authz) → Stigmer gRPC API
  → Auth Interceptor validates JWT against registered IdentityProvider
  → JIT provisions IdentityAccount if first-time user
  → Request proceeds with federated caller identity
```

## Implementation Details

### Proto Changes (stigmer repo)

**New enum** `IdentityAccountProvisioningMode` (`direct`, `federated`, `machine`) in `identityaccount/v1/enum.proto`.

**New fields** on `IdentityAccountSpec`:
- `provisioning_mode` (field 7) — how the account was created
- `identity_provider_ref` (field 8, type `ApiResourceReference`) — which IdentityProvider provisioned it

### Auth Chain Extension (api-authentication lib)

- **`FederatedAuthenticationToken`** — Custom `AbstractAuthenticationToken` carrying validated JWT claims plus IdentityProvider context (ID, org, slug, UserInfo endpoint, raw access token)
- **`FederatedIdentityProvisioner`** — Interface for JIT provisioning (dependency inversion: lib defines contract, service layer implements)
- **`GrpcSecurityConfigBase`** — Extended with `@Qualifier("additionalAuthProviders")` injection point so service layers can register federated providers without modifying the base config
- **`AuthenticationTokenParser`** — Handles `FederatedAuthenticationToken` before `JwtAuthenticationToken` (subclass precedence); constructs compound IDP ID (`federated:{identityProviderId}:{externalSub}`)
- **`RequestCallerIdentityMapper`** — Detects federated auth and delegates to `FederatedIdentityProvisioner` for identity resolution

### Service Layer (stigmer-service)

- **`FederatedJwtAuthenticationProvider`** — Peeks JWT issuer (via Base64 + Jackson, avoiding Nimbus dependency), looks up `IdentityProvider` from issuer cache, validates JWT using cached JWKS decoder. Returns `FederatedAuthenticationToken` on success.
- **`IdentityProviderIssuerCache`** — Maps JWT issuer strings to `IdentityProvider` configs. Refreshed every 5 minutes via `@Scheduled`. Invalidation on IdentityProvider CRUD.
- **`FederatedJwtDecoderCache`** — One `NimbusJwtDecoder` per IdentityProvider, created with audience validation configured at construction time (thread-safe).
- **`UserInfoClient`** — Calls OIDC UserInfo endpoints with Bearer token. Parses standard claims (`sub`, `email`, `given_name`, `family_name`, `picture`).
- **`FederatedIdentityProvisionerImpl`** — Resolves existing accounts (Redis cache → MongoDB fallback) or performs JIT provisioning: fetches UserInfo, builds `IdentityAccount` protobuf with `FEDERATED` mode and `identity_provider_ref`, saves to MongoDB, creates FGA self-ownership tuple, caches idpId→accountId mapping.
- **`FederatedAuthenticationConfig`** — Registers `FederatedJwtAuthenticationProvider` as a qualified `additionalAuthProviders` bean.

### Key Design Choices

1. **Audience validation at decoder creation** (not per-request) — `NimbusJwtDecoder.setJwtValidator()` is not thread-safe for concurrent calls
2. **Jackson + Base64 for issuer peek** — Avoids new Bazel dependency on `com.nimbusds.jwt.JWTParser`
3. **Compound IDP ID format** `federated:{identityProviderId}:{externalSub}` — Ensures global uniqueness across IdentityProviders
4. **No Auth0 accounts for federated users** — They exist only in Stigmer's data layer
5. **No auto-grant of org membership** — Authorization is the consuming platform's responsibility

## Benefits

- **Zero additional infrastructure** for integrators — no proxy, no token exchange endpoint
- **Sub-millisecond auth overhead** after initial cache warm-up (cached JWKS decoders, cached issuer→provider mapping)
- **Automatic identity provisioning** on first request — no manual account creation needed
- **Clean separation** of authentication (Stigmer) from authorization (consuming platform)
- **Extensible** — adding a new identity provider is a single API call; auth chain discovers it automatically via cache refresh

## Impact

- **External platforms** can now authenticate their users against Stigmer APIs by registering an `IdentityProvider` resource
- **Stigmer's auth pipeline** now supports three token types: Auth0 JWT (direct), API key (opaque), and federated JWT (external)
- **Identity model** now tracks provisioning lineage (`provisioning_mode` + `identity_provider_ref`)
- **16 files modified/created** across 2 repositories

## Related Work

- IdentityProvider proto and CRUD (sessions 3-5) — prerequisite for this work
- Federation Refactoring Plan (follow-up) — refactor provisioner to use in-process gRPC for domain boundary compliance
- Organization `management_mode` + `identity_provider_ref` extension — future phase for platform-managed orgs

---

**Status**: ✅ Implemented (pending domain boundary refactoring before merge)
**Timeline**: 1 session (~3 hours)
