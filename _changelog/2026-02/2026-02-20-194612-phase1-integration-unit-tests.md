# Phase 1 Integration Unit Tests: Federation & Platform-Managed Organizations

**Date**: February 20, 2026

## Summary

Added 83 unit tests across 12 test files covering every Phase 1 component of the Stigmer–Planton integration: identity federation (JWT authentication, JIT provisioning, caching), platform-managed organization CRUD enforcement, and supporting infrastructure (repository queries, compound IDP IDs). This establishes the first test coverage for the entire federation and multi-tenant organization subsystem.

## Problem Statement

Phase 1 of the Stigmer–Planton integration introduced several foundational components — federated JWT authentication, JIT identity provisioning, platform-managed organization validation, and external lookup queries. All of these were implemented without accompanying test coverage.

### Pain Points

- No verification that federation authentication correctly resolves issuers, validates JWTs, and passes through unknown tokens
- No validation that JIT provisioning correctly cascades through Redis cache → MongoDB → gRPC create with best-effort UserInfo enrichment
- No coverage for platform-managed organization validation rules (management mode field requirements, IdP authorization, external_org_id uniqueness, immutability enforcement)
- No tests for the referential integrity guard preventing IdentityProvider deletion when referenced by organizations
- No coverage for compound IDP ID format contract (`federated:{providerId}:{sub}`)

## Solution

Systematically designed and implemented unit tests for all Phase 1 components, organized into 10 logical modules covering the full depth of each subsystem. Tests follow existing codebase patterns: step-level execution testing with Mockito mocks for infrastructure dependencies, and pipeline construction/ordering verification.

## Implementation Details

### Module 1: Organization Create — Platform-Managed Steps (20 tests)
`OrganizationCreateHandlerPlatformManagedTest.java` — Validates the four custom pipeline steps: `ValidateManagementModeFields` (field presence/absence by mode), `ValidateAndAuthorizeIdentityProvider` (existence + `can_edit` FGA check), `ValidateExternalOrgIdUnique` (scoped to IdP), `NormalizeManagementMode` (`unspecified` → `self_managed`).

### Module 2: Organization Update — Immutability (8 tests)
`OrganizationUpdateHandlerImmutabilityTest.java` — Verifies `EnforceImmutableFields` rejects explicit changes to `management_mode`, `identity_provider_ref`, and `external_org_id`, while preserving existing values in `newState` (guards against proto3 default-value zeroing).

### Module 3: Organization GetByExternalOrgId (7 tests)
`OrganizationGetByExternalOrgIdHandlerTest.java` — Tests `AuthorizeViaIdentityProvider` (`can_view` on IdP) and `LoadFromRepo` (loads by external coordinates, sets correct response).

### Module 4: Organization Repository (3 tests)
`OrganizationRepoExternalLookupTest.java` — Validates `findByExternalOrgId` compound MongoDB query construction and result mapping.

### Module 5: IdentityProvider Delete Guard (5 tests)
`IdentityProviderDeleteHandlerTest.java` — Tests `CheckNoReferencingOrgs` (prevents deletion when referenced), plus full 7-step pipeline ordering verification.

### Module 6: IdentityProvider GetByReference (6 tests)
`IdentityProviderGetByReferenceHandlerTest.java` — Tests `LoadFromRepo` (org+slug query with kind validation) and `Authorize` (post-load `can_view` FGA check).

### Module 7: Federated JWT Authentication (6 tests)
`FederatedJwtAuthenticationProviderTest.java` — Covers successful authentication (issuer match → JWT decode → `FederatedAuthenticationToken` with compound ID), pass-through for unknown issuers and non-JWT tokens, and failure propagation for invalid JWTs.

### Module 8: Federated Identity Provisioner (6 tests)
`FederatedIdentityProvisionerImplTest.java` — Validates the three-tier resolution cascade (Redis → MongoDB → gRPC JIT create) and best-effort UserInfo integration during provisioning.

### Module 9: UserInfo Client & Caches (15 tests)
- `UserInfoClientTest.java` (6 tests) — Endpoint guard logic, `UserProfile` record contract, name parsing/normalization.
- `IdentityProviderIssuerCacheTest.java` (6 tests) — Cache loading, multi-issuer matching, invalidation mechanics.
- `FederatedJwtDecoderCacheTest.java` (3 tests) — Eviction semantics (`evict`, `evictAll`).

### Module 10: Compound IDP ID Contract (7 tests)
`AuthenticationTokenParserTest.java` — Validates `buildCompoundIdpId` format (`federated:{providerId}:{externalSub}`) across various subject claim values, and `parseId` for `FederatedAuthenticationToken`.

## Benefits

- **Regression safety**: All Phase 1 business rules are now verified — management mode validation, authorization flows, immutability enforcement, and federation authentication
- **Documentation-as-code**: Tests serve as executable specification for federation behavior and platform-managed organization semantics
- **Confidence for future phases**: Phase 2 (Proxy SDK) and Phase 3 (Org Lifecycle Sync) can build on a verified foundation
- **Pattern establishment**: First comprehensive test suite for the integration domain, sets patterns for future testing

## Impact

- **Repos affected**: `stigmer-cloud` (12 new files, 2579 lines)
- **Domains covered**: `iam/identityprovider` (federation + CRUD), `tenancy/organization` (platform-managed CRUD + external lookup), `api-authentication` (compound IDP ID)
- **Test infrastructure**: Established Mockito-based unit testing patterns for `RequestPipelineStepV2` execution, `MongoTemplate` query verification, and FGA authorization mocking

## Related Work

- Phase 1 implementation: sessions 3–7 of project `20260218.01.stigmer-planton-integration`
- Federation refactoring (session 6+): `FederatedJwtAuthenticationProvider`, `FederatedIdentityProvisionerImpl`, in-process gRPC boundary compliance
- Organization platform-managed CRUD (session 7): validation steps, immutability, `getByExternalOrgId`

---

**Status**: Production Ready
**Timeline**: 1 session (~2 hours)
