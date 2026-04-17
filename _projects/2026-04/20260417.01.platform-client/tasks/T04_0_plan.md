# Task T04: Backend — Auth Chain Integration + JIT Provisioning for PlatformClient

**Created**: 2026-04-17
**Status**: NOT STARTED
**Estimated effort**: 1–2 sessions
**Repo**: stigmer-cloud
**Depends on**: T03 (token endpoint must be issuing JWTs)

## Objective

Add a new authentication provider to the server auth chain that validates Stigmer-signed user tokens (from the PlatformClient token endpoint), and wire JIT provisioning so that unknown users are auto-created on first token request.

## Background

Stigmer's auth chain currently has three providers in order:
1. `RedisApiKeyIntrospector` — validates `sk_` API keys
2. `FederatedJwtAuthenticationProvider` — validates federated JWTs from registered IdPs
3. `JwtAuthenticationProvider` (Auth0) — validates Stigmer Console JWTs

PlatformClient user tokens are Stigmer-signed JWTs (issued by the token endpoint in T03). A new provider must validate these tokens and resolve them to an IdentityAccount.

## Task Breakdown

### 1. New Auth Provider: `PlatformClientTokenAuthenticationProvider`

Position in chain: after API key, before federated JWT.

```
New chain: API Key (sk_) → PlatformClient Token → Federated JWT (IdP) → Auth0 JWT (Console)
```

Logic:
- Check if the JWT's `iss` claim is `"stigmer"` (our own issuer)
- If not, return `null` (pass to next provider)
- If yes, validate the JWT signature against Stigmer's signing key
- Extract claims: `sub` (IdentityAccount ID), `platform_client_id`, `org`, `exp`
- Verify the PlatformClient still exists and is not deleted/expired
- Return a `PlatformClientAuthenticationToken` (new auth token type)

### 2. Identity Resolution

After authentication succeeds, `RequestCallerIdentityMapper` must handle the new token type:

- For `PlatformClientAuthenticationToken`, the `sub` claim already contains the Stigmer IdentityAccount ID (set during token minting in T03)
- Look up the IdentityAccount by ID (cache → DB)
- If not found (edge case: account deleted between token mint and use), return UNAUTHENTICATED

### 3. JIT Provisioning on Token Mint (in T03's UserTokenGrantHandler)

When `UserTokenGrantHandler` processes a user-token grant:

1. Look up existing identity mapping: `(platform_client_id, external_user_id)` → `IdentityAccount`
2. **If found**: use existing IdentityAccount ID in the JWT `sub` claim
3. **If not found** and `auto_provision_accounts` is true on the PlatformClient:
   - Create a new IdentityAccount (reuse `FederatedAutoProvisioner` or extract shared provisioning logic)
   - Store the mapping: `(platform_client_id, external_user_id)` → new IdentityAccount ID
   - If `auto_grant_on_org` is set: grant the configured role on the target org (reuse `grantOrgRoleIfConfigured`)
   - Cache the mapping for future lookups
4. **If not found** and `auto_provision_accounts` is false:
   - Return OAuth2 error: `invalid_grant` with description "Unknown user. Enable auto_provision_accounts or create the user via API first."

### 4. Identity Mapping Storage

New collection/table for mapping platform users to Stigmer identities:

```
PlatformClientIdentityMapping:
  platform_client_id: string  (references PlatformClient)
  external_user_id: string    (the user_id from the platform)
  identity_account_id: string (the Stigmer IdentityAccount)
  created_at: timestamp
  last_used_at: timestamp     (updated on each token mint)
```

Indexes:
- `(platform_client_id, external_user_id)` — unique compound index (primary lookup)
- `identity_account_id` — for reverse lookups
- `platform_client_id` — for listing all users of a PlatformClient

Redis caching: `platformclient:{pcId}:user:{extUserId}` → `identityAccountId`

### 5. Shared Provisioning Logic

The JIT provisioning for PlatformClient and the existing JIT provisioning for federation both:
- Create an IdentityAccount
- Optionally grant org access with a role

Extract shared logic from `FederatedAutoProvisionerImpl` into a reusable `IdentityAutoProvisioner` (or have `UserTokenGrantHandler` call `FederatedAutoProvisioner` directly if the interface fits).

### 6. Profile Updates on Subsequent Token Mints

When a known user requests a new token with updated profile info (new email, new name):
- Optionally update the IdentityAccount profile (configurable, same open question as in JIT provisioning)
- Update `last_used_at` on the mapping

## Key Design Decisions

- **JIT happens at token mint time, not at token validation time**: When the platform backend calls `/oauth/token`, that is when we create the user. By the time the token reaches the auth chain, the user already exists.
- **Mapping is per-PlatformClient**: The same external `user_id` from different PlatformClients creates different IdentityAccounts. Each PlatformClient has its own user namespace.
- **Chain position**: PlatformClient tokens go before federated JWTs because they are faster to validate (Stigmer's own signing key vs JWKS fetch).

## Success Criteria

- [ ] `PlatformClientTokenAuthenticationProvider` validates Stigmer-signed JWTs
- [ ] Provider correctly passes non-Stigmer JWTs to next provider in chain
- [ ] Identity mapping: `(platform_client_id, user_id)` → IdentityAccount
- [ ] JIT provisioning creates new users on first token mint
- [ ] Auto-grant org role works when configured
- [ ] `auto_provision_accounts: false` returns error for unknown users
- [ ] Redis caching for identity mappings
- [ ] Unit tests for auth provider, identity resolution, JIT provisioning
- [ ] Integration tests for full flow: create PlatformClient → mint token → use token → API call succeeds

## Files to Create (stigmer-cloud)

```
backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/platformclient/auth/
  ├── PlatformClientTokenAuthenticationProvider.java
  ├── PlatformClientAuthenticationToken.java
  ├── PlatformClientAuthenticationConfig.java
  └── PlatformClientIdentityResolver.java

backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/platformclient/mapping/
  ├── PlatformClientIdentityMapping.java     (MongoDB document)
  ├── PlatformClientIdentityMappingRepo.java
  └── PlatformClientIdentityMappingCache.java (Redis)
```

## Files to Modify (stigmer-cloud)

```
backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/grpc/GrpcSecurityConfigBase.java
  → Add PlatformClientTokenAuthenticationProvider to the provider chain

backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/caller/RequestCallerIdentityMapper.java
  → Handle PlatformClientAuthenticationToken
```
