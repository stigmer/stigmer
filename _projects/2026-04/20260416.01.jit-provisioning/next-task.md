# Next Task: 20260416.01.jit-provisioning

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260416.01.jit-provisioning

**Description**: Add JIT (Just-In-Time) provisioning to IdentityProvider: auto_provision_accounts for identity creation, auto_grant_on_org for authorization, auto_grant_role for role selection, and tenant_org_claim for multi-tenant JWT claim mapping. Eliminates manual createFederatedAccount and IAM policy steps for platforms using federation.
**Goal**: Enable zero-friction federation where a platform JWT works end-to-end without any backend provisioning steps, while preserving full manual control as an opt-in for platforms that need it.
**Tech Stack**: Protobuf, Java/Spring (stigmer-cloud backend), TypeScript (SDK), Go (SDK), Python (SDK), MDX (docs)
**Components**: IdentityProvider proto (stigmer), FederatedAuthenticationToken (stigmer-cloud), FederatedAutoProvisionerImpl (stigmer-cloud), RequestCallerIdentityMapper (stigmer-cloud), IdP validation handlers (stigmer-cloud), SDK type generation (stigmer), federation docs (stigmer)

## Current State

- **Status**: in-progress
- **Last Session**: April 16, 2026 — T07 Testing completed
- **Active Task**: T07 complete, T08 (Documentation) is next

## Session Progress (April 16, 2026 — Session 5)

- Completed T07: Testing audit, gap fixes, and new tests
- Audited all 48+ existing JIT tests across 4 test files — declared JIT-specific coverage sufficient
- Fixed 4 dead test targets in BUILD.bazel that were never running in CI
- Fixed `ValidateIssuerUniquenessTest` getter mismatch (`getErrorStatus()` → `getGrpcStatus()`)
- Fixed `IdentityProviderDeleteHandlerTest` compilation errors (removed stale pipeline construction tests, kept behavioral tests)
- Created `IdentityProviderContextTest` (7 tests) for `shouldAutoProvision()` contract
- Created `ValidateSsoFieldsTest` (10 tests) covering all 3 SSO validation rules (pre-existing gap that DD-004 depends on)
- All 16 IdP/federation tests pass in Bazel CI

## Completed Tasks

| Task | Description | Status |
|------|-------------|--------|
| T01 | Proto: Add JIT fields to IdentityProviderSpec | Complete |
| T02 | Backend: FederatedAuthenticationToken + IdentityProviderContext | Complete |
| T03 | Backend: Generalize Auto-Provisioner (SSO + JIT) | Complete |
| T04 | Backend: Update Auth Pipeline | No-op (covered by T02) |
| T05 | Backend: IdP Validation (six cross-field rules) | Complete |
| T06 | Backend: Tenant Org Resolution | No-op (folded into T03) |
| T07 | Testing: Audit, gap fixes, new tests | Complete |

## Next Steps

1. **T08: Documentation** (stigmer)
   - Update `docs/guides/federation/provision-federated-accounts.mdx`
   - Document JIT provisioning as the recommended approach for simple setups
   - Add "Quick Start" section showing 2-step setup (create IdP + enable JIT)
   - Update SDK code examples to show `getAccessToken` with platform JWT

## Context for Resume

- Proto changes are in stigmer on branch `feat/cli-modernization-2` (shared branch)
- stigmer-cloud T01+T02+T03 committed as `94690a52 feat(backend): add JIT provisioning to federated auth pipeline`
- stigmer-cloud T05 committed as `09976e9b feat(backend): add JIT field validation to IdentityProvider create/update`
- stigmer-cloud T07 changes pending commit (6 files: BUILD.bazel registrations, ValidateSsoFieldsTest, IdentityProviderContextTest, getter fixes, delete handler test cleanup)
- Design decisions DD-001 through DD-004 are established
- All 16 IdP/federation Bazel test targets pass

## Open Questions (from T01 plan, still unresolved)

1. **Rate limiting**: Should auto-provisioning have its own rate limit beyond `rate_limit_budget`?
2. **Profile sync**: Should subsequent authentications update profile data from JWT, or only on first creation?
3. **Personal org**: Should auto-provisioned federated accounts get a personal org?

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.01.jit-provisioning/checkpoints/
```

### 2. Current Task
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.01.jit-provisioning/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.01.jit-provisioning/README.md`

### 4. Key Files Modified in T07 (stigmer-cloud)
- `backend/services/stigmer-service/BUILD.bazel` (MODIFIED — registered 6 new test targets)
- `backend/libs/java/api/api-authentication/BUILD.bazel` (MODIFIED — registered identity_provider_context_test)
- `backend/services/stigmer-service/src/test/java/ai/stigmer/domain/iam/identityprovider/request/handler/ValidateSsoFieldsTest.java` (NEW — 10 tests)
- `backend/libs/java/api/api-authentication/src/test/java/ai/stigmer/apiauthentication/federation/IdentityProviderContextTest.java` (NEW — 7 tests)
- `backend/services/stigmer-service/src/test/java/ai/stigmer/domain/iam/identityprovider/request/handler/ValidateIssuerUniquenessTest.java` (FIXED — getErrorStatus → getGrpcStatus)
- `backend/services/stigmer-service/src/test/java/ai/stigmer/domain/iam/identityprovider/request/handler/IdentityProviderDeleteHandlerTest.java` (FIXED — removed stale pipeline construction tests)

### 5. Key Files from T03 (stigmer-cloud, committed)
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/identityprovider/federation/FederatedAutoProvisionerImpl.java`
- `backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/federation/FederatedAutoProvisioner.java`
- `backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/caller/RequestCallerIdentityMapper.java`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.01.jit-provisioning/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.01.jit-provisioning/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.01.jit-provisioning/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.01.jit-provisioning/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.01.jit-provisioning/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.01.jit-provisioning/tasks/`
3. [ ] Review design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.01.jit-provisioning/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.01.jit-provisioning/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.01.jit-provisioning/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.01.jit-provisioning/dont-dos/`
6. [ ] Verify T07 stigmer-cloud changes are committed
7. [ ] Continue with T08 (Documentation)

## Quick Commands

After loading context:
- "Continue with T08" - Start documentation updates
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
