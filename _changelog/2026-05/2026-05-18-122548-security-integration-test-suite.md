# Security Integration Test Suite — Production JWT Validation

**Date**: May 18, 2026

## Summary

Built a dedicated integration test suite that starts the Java service in production security mode (no `STIGMER_SECURITY_MODE=test` bypass), using mock OIDC and JWKS servers to exercise the real `GrpcSecurityConfigBase` interceptor chain end-to-end. This closes the Phase 2 gap where `FederatedJwtAuthenticationProvider`, `PlatformClientTokenAuthenticationProvider`, and the Auth0 `JwtAuthenticationProvider` were never tested through the actual gRPC security pipeline.

## Problem Statement

The existing integration test suite runs with `STIGMER_SECURITY_MODE=test`, which replaces the entire production security chain with a synthetic caller interceptor (`IntegrationTestSecurityConfig`). While this enables business logic testing without Auth0 dependencies, it means five critical production components are never exercised:

### Pain Points

- `GrpcSecurityConfigBase` (the production auth interceptor) never loads in tests
- `FederatedJwtAuthenticationProvider` (IdP JWT validation via per-IdP JWKS) never runs — the primary integration vector for platform builders
- `PlatformClientTokenAuthenticationProvider` never validates Stigmer-issued JWT signatures
- `JwtAuthenticationProvider` (Auth0 path) never runs
- `RequestCallerIdentityMapper` never resolves a real authentication principal
- The mock JWKS server infrastructure existed but had zero test consumers
- No test proved that invalid, expired, or wrongly-signed JWTs are actually rejected

## Solution

Option B from the Phase 2 design decision: a separate Go test package (`test/integration-security/`) with its own `TestMain` that starts the Java service in production security mode, pointing Auth0 configuration at a mock OIDC server. A mock Auth0 JWT bootstraps authenticated access, and a separate mock JWKS server provides federation keys for IdentityProvider tests.

## Implementation Details

### Harness Infrastructure Enhancements

- **`harness/mock_jwks_server.go`**: Added OIDC discovery capability (`StartMockOIDCServer`, `NewMockOIDCServer`), serving `/.well-known/openid-configuration` with the minimal fields Spring Security's NimbusJwtDecoder needs. Added `NewMockJWKSServer` and `Close()` for TestMain lifecycle. Added `SignJWTWithDifferentKey` for wrong-key rejection testing. Changed `StartMock*` signatures from `*testing.T` to `testing.TB` for broader compatibility.
- **`harness/mongo_seeder.go`** (new): `MongoSeeder` providing direct MongoDB access for pre-seeding `identity_account` documents. Supports both standard Auth0-style accounts (`SeedIdentityAccount`) and federated accounts with `identityProviderRef` (`SeedFederatedIdentityAccount`). Document shape matches the Java service's `IntegrationTestDataSeeder` and `IdentityAccountRepo.findByIdpId()` query exactly.
- **`harness/service.go`**: Added `SecurityMode` type (`SecurityModeTest` / `SecurityModeProduction`), plus `Auth0IssuerURL` and `Auth0Audience` fields on `ServiceConfig`. When `Security == SecurityModeProduction`, `buildServiceEnv` emits `STIGMER_SECURITY_MODE=production` and overrides `SECURITY_AUTHENTICATION_IDP_URL` to point at the mock OIDC server. Fully backward compatible — empty `Security` defaults to test mode.

### New Test Package (`test/integration-security/`)

- **`suite_test.go`**: `TestMain` that starts mock OIDC (fake Auth0), mock JWKS (fake IdP), seeds a bootstrap identity in MongoDB, starts the Java service in production security mode, and creates an authenticated bootstrap gRPC connection using a mock Auth0 JWT.
- **`jwt_federation_test.go`** (6 tests): Valid federated JWT accepted, wrong issuer rejected, expired token rejected, wrong signing key rejected, wrong audience rejected, auto-provisioning via JIT.
- **`jwt_platform_client_test.go`** (2 tests): PlatformClient mint-and-use flow through production auth, secret rotation with old-secret rejection.

### CI Integration

- **`test/integration-security/Makefile`**: Local Makefile with gotestsum-based `test` target
- **Root `Makefile`**: Added `test-integration-security` delegate target

### TLS Validation

Confirmed via code analysis that `GrpcSecurityConfigBase.auth0JwtDecoder()` passes `authenticationConfig.getIdpUrl()` directly to `JwtDecoders.fromOidcIssuerLocation()` with no HTTPS enforcement in the stigmer-cloud codebase. The `SECURITY_AUTHENTICATION_IDP_URL` environment variable overrides the YAML's `https://${AUTH0_DOMAIN}/` template, allowing our plain HTTP mock OIDC server to work without TLS.

## Benefits

- The production JWT validation chain (`GrpcSecurityConfigBase` → `ProviderManager` → 4 authentication providers → `RequestCallerIdentityMapper`) is now tested end-to-end
- Federated IdentityProvider JWT validation is proven: valid tokens accepted, invalid tokens (wrong issuer, expired, wrong key, wrong audience) rejected
- PlatformClient token minting and validation works through the real `PlatformClientTokenAuthenticationProvider`
- The mock OIDC server enables testing the Auth0 JWT path without an external Auth0 tenant
- Secret rotation is proven to invalidate old credentials in production security mode
- Existing test suite is completely unaffected — zero changes to test behavior or configuration

## Impact

- **New test module**: `test/integration-security/` (3 test files, 1 Makefile, 1 go.mod)
- **Harness additions**: 1 new file (`mongo_seeder.go`), 2 modified files (`mock_jwks_server.go`, `service.go`)
- **Build system**: `go.work` updated, root `Makefile` updated with new target
- **Dependencies**: Added `go.mongodb.org/mongo-driver/v2` to integration test module for direct Mongo seeding
- **Test count**: 8 new security-focused integration tests

## Related Work

- Phase 1 auth integration tests (32+ tests in `test/integration/auth_*.go`) — business logic under `STIGMER_SECURITY_MODE=test`
- Mock JWKS server originally built in Phase 1 but unused — now the foundation for both test suites
- `FederatedJwtAuthenticationProvider` and `FederatedJwtDecoderCache` in stigmer-cloud — the production components now under test
- `IntegrationTestSecurityConfig` in stigmer-cloud — the test-mode bypass that this suite intentionally does not use

---

**Status**: Production Ready
**Timeline**: Single session
