# Task T03: Backend — Token Endpoint + Stigmer-Signed JWT Issuance

**Created**: 2026-04-17
**Status**: NOT STARTED
**Estimated effort**: 2 sessions
**Repo**: stigmer-cloud
**Depends on**: T02 (PlatformClient CRUD must be functional)

## Objective

Implement `POST /oauth/token` — a REST endpoint (not gRPC) following OAuth2 conventions that accepts client credentials and returns short-lived, Stigmer-signed JWTs. Supports two grant types: `client_credentials` (machine-to-machine) and `urn:stigmer:grant-type:user-token` (user-scoped tokens for browser use).

## Background

This is the core innovation of the PlatformClient feature. The OAuth2 spec (RFC 6749) mandates that token endpoints accept `application/x-www-form-urlencoded` POST requests, so this must be a REST endpoint rather than a gRPC service. Most of stigmer-cloud's API surface is gRPC, so this endpoint needs its own Spring MVC controller and security configuration.

## Task Breakdown

### 1. JWT Signing Key Management

- Generate or configure an RSA or EC key pair for Stigmer-signed JWTs
- Key storage: environment variable, secrets manager, or Spring Boot config (follow existing Auth0 JWT decoder key management patterns)
- Expose the public key via a JWKS endpoint (`GET /.well-known/jwks.json`) so tokens can be verified
- Key rotation strategy: support multiple active keys via `kid` (key ID) header

### 2. REST Controller: `POST /oauth/token`

Spring MVC controller (not gRPC):

**Request format** (application/x-www-form-urlencoded):
```
grant_type=client_credentials|urn:stigmer:grant-type:user-token
client_id=stgm_cid_...
client_secret=stgm_cs_...
# User token grant only:
user_id=...
user_email=...
user_name=...
org_id=...
```

**Client authentication:**
- Look up PlatformClient by `client_id`
- Hash the provided `client_secret` and compare against stored hash
- Reject if expired, not found, or hash mismatch
- Rate limit by client_id to prevent brute-force

**Grant type: `client_credentials`**
- Returns a JWT representing the PlatformClient itself (org-level identity)
- Claims: `sub` = PlatformClient ID, `org` = PlatformClient's org, `iss` = "stigmer", `exp`, `iat`, `jti`
- Token lifetime: 1 hour (configurable)

**Grant type: `urn:stigmer:grant-type:user-token`**
- Requires `user_id` (mandatory), `user_email`, `user_name`, `org_id` (optional)
- Resolves or creates the user's IdentityAccount (see T04 for JIT provisioning)
- Returns a JWT representing the specific user
- Claims: `sub` = Stigmer IdentityAccount ID, `ext_user_id` = platform's user_id, `email`, `name`, `org`, `platform_client_id`, `iss` = "stigmer", `exp`, `iat`, `jti`
- Token lifetime: 15 minutes (configurable, shorter than client_credentials since these go to browsers)

### 3. Response Format

Follow OAuth2 token response format (RFC 6749 Section 5.1):
```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 900
}
```

Error responses follow RFC 6749 Section 5.2:
```json
{
  "error": "invalid_client",
  "error_description": "Invalid client_id or client_secret"
}
```

Standard error codes: `invalid_client`, `invalid_grant`, `invalid_request`, `unauthorized_client`.

### 4. Security Configuration

- The `/oauth/token` endpoint must be publicly accessible (no Bearer token required — it IS the token source)
- Spring Security: exclude from the gRPC auth chain, add its own client credential validation
- CORS: respect `allowed_origins` from the PlatformClient spec
- Rate limiting: per client_id, prevent credential brute-force

### 5. Token Revocation (optional, future)

- Design for but do not implement: `POST /oauth/revoke` endpoint
- Store token JTI for revocation checks (or use short TTL and accept the window)

## Key Design Decisions

- **REST, not gRPC**: OAuth2 spec requires `application/x-www-form-urlencoded`. This is the one REST endpoint in an otherwise gRPC-first API.
- **Stigmer as JWT issuer**: Stigmer signs its own JWTs with its own key pair. This is distinct from Auth0 JWTs (Console) and federated JWTs (IdPs).
- **Short-lived user tokens**: 15-minute default for user tokens (browser use). Platforms can refresh by calling the token endpoint again.
- **No refresh tokens**: Keep it simple. The platform backend calls `/oauth/token` again when the token expires. The backend already has the credentials.

## Success Criteria

- [ ] `POST /oauth/token` accepts form-urlencoded requests
- [ ] `client_credentials` grant returns org-level JWT
- [ ] `urn:stigmer:grant-type:user-token` grant returns user-scoped JWT
- [ ] JWTs are signed with Stigmer's key pair and verifiable
- [ ] JWKS endpoint serves the public key
- [ ] OAuth2-compliant error responses
- [ ] Rate limiting on client authentication attempts
- [ ] Endpoint excluded from gRPC auth chain, has its own security config
- [ ] Unit + integration tests for both grant types

## Files to Create (stigmer-cloud)

```
backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/platformclient/token/
  ├── TokenEndpointController.java       (Spring MVC @RestController)
  ├── TokenEndpointSecurityConfig.java   (Spring Security for /oauth/token)
  ├── StigmerJwtIssuer.java              (JWT creation + signing)
  ├── StigmerJwksController.java         (GET /.well-known/jwks.json)
  ├── ClientCredentialsGrantHandler.java
  ├── UserTokenGrantHandler.java
  └── TokenEndpointRateLimiter.java
```
