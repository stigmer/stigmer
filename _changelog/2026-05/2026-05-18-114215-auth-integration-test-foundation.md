# Authentication Integration Test Foundation

**Date**: May 18, 2026

## Summary

Built the complete integration test foundation for Stigmer's authentication and authorization surface. Added IAM gRPC clients, test helpers, a mock JWKS server, and 32+ integration tests covering PlatformClient credential lifecycle, API key CRUD, IdentityProvider federation, IAM resource management, and FGA authorization enforcement. Updated all code-producing roles to embed the philosophy that every feature ships with its tests.

## Problem Statement

The integration test suite had zero coverage for authentication and authorization. The test harness ran with `STIGMER_SECURITY_MODE=test`, bypassing all JWT validation, and the `harness/clients.go` had no IAM clients. No tests exercised PlatformClient credential flows, API key lifecycle, IdentityProvider federation, federated account provisioning, IAM policy grant/revoke, or end-to-end FGA authorization enforcement through the gRPC interceptor chain.

### Pain Points

- PlatformClient (the primary auth mechanism for platform builders) had zero test coverage
- No tests verified that mintUserToken accepts valid credentials and rejects invalid ones
- JIT provisioning modes (manual, JIT, JIT+auto-grant) were untested
- Secret rotation was untested — no proof that old secrets are invalidated
- API key lifecycle (create, use, delete, verify revocation) had no tests
- FGA authorization enforcement was tested only at the OpenFGA model level, not through the actual gRPC interceptor chain
- Federated account provisioning (create, update, deprovision) had no tests
- IAM resource CRUD (invitations, OAuthApp, IAM policies) had no tests
- Role definitions did not mandate that feature authors write their own tests

## Solution

Three-layer approach: harness infrastructure, test files, and role philosophy updates.

## Implementation Details

### Harness Infrastructure

- **`harness/clients.go`**: Added 15 IAM gRPC clients (PlatformClient command/query/token, IdentityProvider, IdentityAccount, ApiKey, IamPolicy, Invitation, OAuthApp — command + query each)
- **`harness/auth_helpers.go`** (new): `CreatePlatformClient` with option pattern, `MintUserToken`, `CreateIdentityProvider`, `CreateApiKey`, `GRPCConnWithBearer`/`GRPCConnWithApiKey` for creating authenticated connections
- **`harness/mock_jwks_server.go`** (new): In-process HTTP server generating RSA-2048 keys, serving JWKS endpoint, signing JWTs with configurable subject/audience/expiry/extra claims — enables IdentityProvider testing without an external IdP

### Test Files (5 new)

- **`auth_platform_client_test.go`** (10 tests): credential generation with stgm_cid_ prefix, secret-not-returned-on-get, mintUserToken valid/invalid credentials, JIT provisioning modes, secret rotation, deletion invalidation, org-scoped identity resolution, listByOrg
- **`auth_api_key_test.go`** (3 tests): key creation with fingerprint, deletion, findAll listing
- **`auth_authorization_enforcement_test.go`** (5 tests, FGA-gated): auto-granted viewer can list but cannot create agents, cannot delete, cross-org access denied, session personal resource isolation
- **`auth_iam_resources_test.go`** (7 tests): whoAmI, provisionMyAccount idempotency, IdentityProvider CRUD + listByOrg, federated account lifecycle (create/update/deprovision), IAM policy grant/revoke, invitation CRUD, OAuthApp CRUD
- **`auth_identity_provider_test.go`** (7 tests): IdP create/update/delete/apply, JIT config persistence, manual federated provisioning with external sub lookup, mock JWKS sign/verify

### Role Updates (6 files)

Every code-producing role now carries the same addition: "You own the tests for the code you write. Tests are not a follow-up task for the tester role — they are part of your definition of done."

- 001 Architect, 003 CLI/TUI, 004 Web UX, 005 AI Engineer, 007 Backend Engineer: added ownership mandate
- 008 Tester: reframed as strategy/infrastructure owner with shared responsibility; updated harness documentation

## Benefits

- PlatformClient auth flow (the primary integration path for platform builders) now has end-to-end test coverage
- Secret rotation, JIT provisioning, and credential invalidation are proven correct
- FGA authorization enforcement is tested through the real gRPC interceptor chain, not just the OpenFGA model
- Mock JWKS server enables future IdentityProvider JWT validation tests without external dependencies
- Role updates create a sustainable culture where testing accompanies every feature

## Impact

- **Integration test suite**: ~45 files -> ~50 files (5 new auth test files)
- **Harness**: 3 new utility files, 15 new gRPC clients
- **Roles**: 6 roles updated with testing ownership philosophy
- **Dependencies**: Added `github.com/golang-jwt/jwt/v5` to test module for mock JWKS signing

## Related Work

- Existing FGA model tests in `fga_model_test.go` (now complemented by interceptor-level enforcement tests)
- Integration test harness established in the May 2026 e2e test sprint
- PlatformClient and IdentityProvider proto contracts designed for multi-tenant platform builder authentication

---

**Status**: Production Ready
**Timeline**: Single session
