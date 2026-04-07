# SSO Auto-Provisioning for Self-Managed Organizations

**Date**: April 7, 2026

## Summary

Implemented SSO auto-provisioning in the Stigmer backend: when a user authenticates via an SSO-enabled Identity Provider and no federated account exists, the system automatically creates one and grants viewer-level access to the organization. This is Phase 3 of the SSO login flow sub-project and the key behavioral change that enables frictionless first-login for SSO users.

## Problem Statement

When an organization enables SSO via their own Identity Provider (Okta, Entra ID, etc.), every team member must have a federated account pre-created before they can log in. This creates a chicken-and-egg problem for self-managed SSO orgs: the admin enables SSO, but then must manually create federated accounts for every user before they can authenticate.

### Pain Points

- Org admins must manually create federated accounts for every SSO user before they can log in
- No self-service onboarding path for SSO users — admin bottleneck on every new hire
- Platform-managed IdPs (Auth0) handle this differently, but self-managed SSO IdPs had no provisioning path
- The existing `FederatedIdentityResolverImpl` was read-only — returning empty when no account exists resulted in a 401

## Solution

Introduced a new `SsoAutoProvisioner` component that sits in the authentication pipeline alongside the existing `FederatedIdentityResolver`. When the resolver returns empty (no existing account) and the IdP is an SSO provider, the mapper delegates to the auto-provisioner which creates the federated account, grants a viewer role, and caches the identity mapping — all within the authentication request.

The key architectural decision was to keep the resolver's read-only contract intact and introduce a separate component for the mutation, preserving separation of concerns in the authentication pipeline.

## Implementation Details

### New Components

- **`SsoAutoProvisioner` interface** (api-authentication): Defines the provisioning contract — `String provision(FederatedAuthenticationToken)`
- **`SsoAutoProvisionerImpl`** (stigmer-service): Extracts OIDC claims (email, name, picture) from the JWT, creates the identity account via `IdentityAccountGrpcRepo`, grants viewer role via `IamPolicyGrpcRepo`, and caches the mapping in Redis
- **`SsoAutoProvisioningException`**: Custom exception for provisioning failures

### Modified Components

- **`FederatedAuthenticationToken`**: Extended with `isSsoProvider` boolean flag, carried from the IdP's `spec.is_sso_provider` field through the authentication pipeline
- **`FederatedJwtAuthenticationProvider`**: Passes `is_sso_provider` from the IdP spec to the authentication token
- **`RequestCallerIdentityMapper`**: New `resolveFederatedIdentity()` method implements the fallback: resolve → if empty + SSO → auto-provision → if not SSO → reject

### Race Condition Handling

Concurrent first-login attempts by the same SSO user are handled gracefully: if `IdentityAccountGrpcRepo.create()` returns `ALREADY_EXISTS`, the provisioner re-queries the existing account instead of failing.

### Build Infrastructure

- Added Mockito (`mockito-core:5.14.2`, `mockito-junit-jupiter:5.14.2`) to `MODULE.bazel` Maven dependencies
- Registered 7 new Bazel test targets (5 in stigmer-service, 2 in api-authentication)
- Previously Mockito-based tests were IDE-only; they are now part of the Bazel CI pipeline

### Test Coverage

- `SsoAutoProvisionerImplTest`: Successful provisioning, claim extraction variants (full claims, name fallback, email-prefix fallback), race condition handling, missing email rejection, creation failure, best-effort role/cache failure resilience
- `RequestCallerIdentityMapperTest`: Existing account resolution, SSO auto-provisioning trigger, non-SSO rejection, missing provisioner graceful degradation
- `FederatedJwtAuthenticationProviderTest`: `isSsoProvider` flag propagation for both SSO and non-SSO IdPs

## Benefits

- **Zero-friction SSO onboarding**: Team members log in with their org's IdP on first visit — no admin pre-provisioning needed
- **Secure by default**: Auto-provisioned users get viewer role only (read-only access); admin must explicitly upgrade to member for billable operations
- **Backward compatible**: Platform-managed IdPs are completely unchanged — only SSO IdPs (`is_sso_provider = true`) trigger auto-provisioning
- **Resilient**: Race conditions, role grant failures, and cache failures are all handled gracefully without blocking account creation
- **Testable**: Comprehensive unit test coverage with all tests in the Bazel build cycle

## Impact

- **Self-managed SSO org admins**: No longer need to pre-create accounts for every team member
- **SSO end users**: Can authenticate on first visit without waiting for admin to provision their account
- **Authentication pipeline**: Minimal changes — the resolver remains read-only, new behavior is additive via a separate component
- **Bazel CI**: 7 new tests in the build cycle, Mockito now available as a first-class test dependency

## Related Work

- Phase 1: Proto changes for lifecycle RPCs and `SsoProviderInfo.expected_audience` (changelog: `2026-04-07-154352`)
- Phase 2: Backend handlers for `updateFederatedAccount` and `deprovisionFederatedAccount` (changelog: `2026-04-07-161730`)
- Design decision: `design-decisions/001-sso-auto-provisioning-viewer-role.md`
- Next: Phase 4 (Web App SSO Login Page), Phase 5 (SSO URL on IdP Detail Panel), Phase 6 (Documentation)

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
