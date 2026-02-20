---
name: Phase 1 Integration Testing
overview: Write comprehensive unit tests for all Phase 1 components (IdentityProvider CRUD, Federated Authentication Flow, Organization Platform-Managed CRUD) following established codebase patterns, focusing on testing actual business logic through step execution rather than just pipeline wiring.
todos:
  - id: m1-org-create-steps
    content: "Module 1: Organization platform-managed create steps (ValidateManagementModeFields, ValidateAndAuthorizeIdentityProvider, ValidateExternalOrgIdUnique, NormalizeManagementMode)"
    status: completed
  - id: m1-org-update-immutability
    content: "Module 1: Organization update EnforceImmutableFields step tests"
    status: completed
  - id: m2-org-get-external
    content: "Module 2: OrganizationGetByExternalOrgIdHandler step tests (AuthorizeViaIdentityProvider, LoadFromRepo)"
    status: completed
  - id: m3-org-repo
    content: "Module 3: OrganizationRepo findByExternalOrgId query construction test"
    status: completed
  - id: m4-idp-delete
    content: "Module 4: IdentityProvider delete CheckNoReferencingOrgs step + pipeline construction"
    status: completed
  - id: m5-idp-getbyref
    content: "Module 5: IdentityProvider GetByReference custom auth + load steps"
    status: completed
  - id: m6-fed-jwt-auth
    content: "Module 6: FederatedJwtAuthenticationProvider tests"
    status: completed
  - id: m7-fed-provisioner
    content: "Module 7: FederatedIdentityProvisionerImpl tests (cache layers + JIT provision)"
    status: completed
  - id: m8-userinfo-client
    content: "Module 8: UserInfoClient tests (HTTP call, response parsing, error handling)"
    status: completed
  - id: m9-caches
    content: "Module 9: IdentityProviderIssuerCache + FederatedJwtDecoderCache tests"
    status: completed
  - id: m10-compound-id
    content: "Module 10: Compound IDP ID format tests"
    status: completed
isProject: false
---

# Phase 1 Integration Testing Plan

## Current State

- **49 existing tests**, all unit tests using JUnit 5 + Mockito (no integration test infrastructure)
- **Zero tests** exist for any Phase 1 component
- Two test patterns in the codebase:
  - **Step execution tests** (e.g., [WorkflowExecutionCancelHandlerTest.java](stigmer-cloud/backend/services/stigmer-service/src/test/java/ai/stigmer/domain/agentic/workflowexecution/request/handler/WorkflowExecutionCancelHandlerTest.java)) -- instantiate each step, execute with a context, assert on `RequestPipelineStepResultV2`. **Tests actual business logic.**
  - **Pipeline construction tests** (e.g., [ProjectDeleteHandlerTest.java](stigmer-cloud/backend/services/stigmer-service/src/test/java/ai/stigmer/domain/agentic/project/request/handler/ProjectDeleteHandlerTest.java)) -- uses reflection to verify step ordering. **Tests wiring only.**

## Testing Strategy

Focus on **step execution tests** (the higher-value pattern) for all custom pipeline steps, plus dedicated tests for standalone federation components. Pipeline construction tests (step ordering) will be added where handlers have custom step configurations, but not at the expense of logic-level testing.

All test files live under:

```
stigmer-cloud/backend/services/stigmer-service/src/test/java/ai/stigmer/domain/
```

---

## Module 1: Organization Platform-Managed Pipeline Steps

The four new create steps and one update step contain critical business logic that enforces platform-managed invariants. These are the highest-priority tests because they guard data integrity.

**Test file:** `domain/tenancy/organization/request/handler/OrganizationCreateHandlerPlatformManagedTest.java`

**Source:** [OrganizationCreateHandler.java](stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/tenancy/organization/request/handler/OrganizationCreateHandler.java)

### ValidateManagementModeFields (lines 115-148)

- platform_managed + valid IdP ref + valid external_org_id --> success
- platform_managed + missing IdP ref --> INVALID_ARGUMENT
- platform_managed + missing external_org_id --> INVALID_ARGUMENT
- self_managed + IdP ref present --> INVALID_ARGUMENT
- self_managed + external_org_id present --> INVALID_ARGUMENT
- self_managed + both empty --> success
- unspecified mode + both empty --> success (normalization happens later)

### ValidateAndAuthorizeIdentityProvider (lines 161-216)

- Non-platform_managed mode --> skip (success)
- platform_managed + IdP exists + caller has can_edit --> success
- platform_managed + IdP not found --> NOT_FOUND
- platform_managed + IdP exists + caller unauthorized --> PERMISSION_DENIED
- Verify MongoTemplate query construction (org + slug criteria on identity_provider collection)

### ValidateExternalOrgIdUnique (lines 226-263)

- Non-platform_managed mode --> skip (success)
- platform_managed + unique external_org_id --> success
- platform_managed + duplicate external_org_id for same IdP --> ALREADY_EXISTS
- Verify compound query (identityProviderRef.org + identityProviderRef.slug + externalOrgId)

### NormalizeManagementMode (lines 319-338)

- unspecified --> normalized to self_managed (context newState mutated)
- self_managed --> unchanged
- platform_managed --> unchanged

**Test file:** `domain/tenancy/organization/request/handler/OrganizationUpdateHandlerImmutabilityTest.java`

**Source:** [OrganizationUpdateHandler.java](stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/tenancy/organization/request/handler/OrganizationUpdateHandler.java)

### EnforceImmutableFields (lines 87-137)

- Attempt to change management_mode --> INVALID_ARGUMENT
- Attempt to change identity_provider_ref --> INVALID_ARGUMENT
- Attempt to change external_org_id --> INVALID_ARGUMENT
- Update description only (mutable field) --> success, immutable fields preserved from existing
- Request with default/empty values for immutable fields --> success (no false positive rejection)
- Verify newState has immutable fields copied from existingResource

---

## Module 2: Organization GetByExternalOrgId Handler

**Test file:** `domain/tenancy/organization/request/handler/OrganizationGetByExternalOrgIdHandlerTest.java`

**Source:** [OrganizationGetByExternalOrgIdHandler.java](stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/tenancy/organization/request/handler/OrganizationGetByExternalOrgIdHandler.java)

### AuthorizeViaIdentityProvider step (lines 79-133)

- IdP exists + caller has can_view --> success
- IdP not found --> NOT_FOUND
- IdP exists + caller unauthorized --> PERMISSION_DENIED
- Verify query uses correct collection and criteria

### LoadFromRepo step (lines 141-172)

- Organization found --> success, target set on context
- Organization not found --> NOT_FOUND with descriptive message

---

## Module 3: Organization Repository -- findByExternalOrgId

**Test file:** `domain/tenancy/organization/repo/OrganizationRepoExternalLookupTest.java`

**Source:** [OrganizationRepo.java](stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/tenancy/organization/repo/OrganizationRepo.java)

- Verify compound query construction: `spec.identityProviderRef.org` + `spec.identityProviderRef.slug` + `spec.externalOrgId`
- Document found --> return Optional with deserialized Organization
- Document not found --> return empty Optional

---

## Module 4: IdentityProvider Delete -- CheckNoReferencingOrgs

**Test file:** `domain/iam/identityprovider/request/handler/IdentityProviderDeleteHandlerTest.java`

**Source:** [IdentityProviderDeleteHandler.java](stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/identityprovider/request/handler/IdentityProviderDeleteHandler.java)

### CheckNoReferencingOrgs step

- No referencing orgs (count = 0) --> success
- Referencing orgs exist (count > 0) --> FAILED_PRECONDITION with descriptive message
- Verify query criteria on organization collection

### Pipeline construction

- Verify 7 steps in correct order (including CheckNoReferencingOrgs at position 4)

---

## Module 5: IdentityProvider GetByReference -- Custom Authorization

**Test file:** `domain/iam/identityprovider/request/handler/IdentityProviderGetByReferenceHandlerTest.java`

**Source:** [IdentityProviderGetByReferenceHandler.java](stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/identityprovider/request/handler/IdentityProviderGetByReferenceHandler.java)

### LoadFromRepo step

- IdP found by org + slug --> success, target set on context
- IdP not found --> NOT_FOUND

### Authorize step (custom post-load authorization)

- Caller has can_view on loaded IdP --> success
- Caller unauthorized --> PERMISSION_DENIED
- Verify authorization uses identity_provider resource kind + loaded ID

---

## Module 6: Federated JWT Authentication Provider

**Test file:** `domain/iam/identityprovider/federation/FederatedJwtAuthenticationProviderTest.java`

**Source:** [FederatedJwtAuthenticationProvider.java](stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/identityprovider/federation/FederatedJwtAuthenticationProvider.java)

- Known issuer + valid JWT --> returns FederatedAuthenticationToken with correct provider metadata
- Unknown issuer --> throws AuthenticationException (falls through to next provider)
- Known issuer + invalid JWT (bad signature/expired) --> throws AuthenticationException
- Verify FederatedAuthenticationToken carries: identityProviderId, org, slug, userinfoEndpoint
- Non-Bearer authentication type --> throws AuthenticationException

---

## Module 7: Federated Identity Provisioner

**Test file:** `domain/iam/identityprovider/federation/FederatedIdentityProvisionerImplTest.java`

**Source:** [FederatedIdentityProvisionerImpl.java](stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/identityprovider/federation/FederatedIdentityProvisionerImpl.java)

### resolveOrProvision

- Redis cache hit --> return cached ID, no MongoDB or gRPC calls
- Redis miss + MongoDB hit --> return existing ID, cache populated
- Redis miss + MongoDB miss --> JIT provision via gRPC create, cache populated, return new ID
- JIT provision: verify IdentityAccount built with correct compound IDP ID, provisioning_mode=federated, identity_provider_ref

### UserInfo integration

- UserInfo success --> profile fields populated on IdentityAccount
- UserInfo failure --> provision still succeeds (best-effort profile)

---

## Module 8: UserInfo Client

**Test file:** `domain/iam/identityprovider/federation/UserInfoClientTest.java`

**Source:** [UserInfoClient.java](stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/identityprovider/federation/UserInfoClient.java)

- Successful response with all fields --> UserProfile populated correctly
- Response with `name` only (no given_name/family_name) --> name split correctly
- Response with `given_name` + `family_name` (no name) --> used directly
- HTTP error --> returns empty Optional
- Verify Bearer token is set in request headers

---

## Module 9: Issuer and Decoder Caches

**Test file:** `domain/iam/identityprovider/federation/IdentityProviderIssuerCacheTest.java`

- findByIssuer for known issuer --> returns IdentityProvider
- findByIssuer for unknown issuer --> returns empty
- Cache refresh picks up new providers
- Issuer matching works correctly with `allowed_issuers` list

**Test file:** `domain/iam/identityprovider/federation/FederatedJwtDecoderCacheTest.java`

- getOrCreate for new provider --> creates decoder with correct JWKS URI and audience
- getOrCreate for existing provider --> returns cached decoder (same instance)
- Eviction removes decoder (subsequent call creates new one)

---

## Module 10: Compound IDP ID Construction

**Test file:** `domain/iam/identityprovider/federation/CompoundIdpIdTest.java` (or in AuthenticationTokenParserTest)

**Source:** [AuthenticationTokenParser.java](stigmer-cloud/backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/jwt/AuthenticationTokenParser.java)

- FederatedAuthenticationToken --> compound ID: `federated:{providerId}:{externalSub}`
- Verify format with various sub claim values (including `auth0|...` pipe characters)

---

## Execution Order

Work modules in dependency order so earlier tests validate foundations for later ones:

1. **Modules 1-3** (Organization platform-managed) -- highest risk, most custom logic
2. **Modules 4-5** (IdentityProvider delete guard + getByRef) -- cross-domain referential integrity
3. **Modules 6-9** (Federation flow) -- auth flow components, tested bottom-up
4. **Module 10** (Compound IDP ID) -- small utility, validates format contract

Each module is a self-contained test file that can be implemented, compiled, and verified independently.

---

## Out of Scope (Noted for Future)

- **Integration tests with real infrastructure** (TestContainers for MongoDB, WireMock for UserInfo HTTP): The codebase currently has zero integration test infrastructure. Adding this would be a significant investment that should be a dedicated effort, not bolted onto this testing pass.
- **IdentityProvider Create/Update handler pipeline construction tests**: These use shared/reusable steps (validate, authorize, persist, etc.) that are already covered by the shared library tests. Only custom steps warrant new tests.
- **RequestCallerIdentityMapper federated path test**: This component orchestrates the federation flow but delegates to components tested in Modules 6-9. A test here would largely duplicate those tests.

