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
- **Last Session**: April 16, 2026 — T05 IdP JIT field validation completed
- **Active Task**: T05 complete, T07 is next (T04 and T06 confirmed as no-ops)

## Session Progress (April 16, 2026 — Session 4)

- Completed T05: Created `ValidateJitFields` pipeline step with six cross-field validation rules
- Design decision DD-004: Reject JIT authorization fields on SSO providers (no phantom config)
- New validation rules: SSO/JIT separation, grant requires provisioning, tenant claim requires provisioning, tenant claim requires grants, orphaned role, owner not auto-grantable
- 14 test cases pass, all existing federation tests pass, full library compilation verified
- Confirmed T04 (auth pipeline) is a no-op — T02 already updated `RequestCallerIdentityMapper.shouldAutoProvision()`
- Confirmed T06 (tenant org resolution) is folded into T03 — already implemented in `FederatedAutoProvisionerImpl.resolveTargetOrg()`

## Completed Tasks

| Task | Description | Status |
|------|-------------|--------|
| T01 | Proto: Add JIT fields to IdentityProviderSpec | Complete |
| T02 | Backend: FederatedAuthenticationToken + IdentityProviderContext | Complete |
| T03 | Backend: Generalize Auto-Provisioner (SSO + JIT) | Complete |
| T04 | Backend: Update Auth Pipeline | No-op (covered by T02) |
| T05 | Backend: IdP Validation (six cross-field rules) | Complete |
| T06 | Backend: Tenant Org Resolution | No-op (folded into T03) |

## Next Steps

1. **T07: Testing** (stigmer-cloud)
   - Review what additional integration-level tests are needed
   - T02 added 3 tests, T03 added 7 tests, T05 added 14 tests — substantial unit coverage exists
   - May need end-to-end handler tests or validation integration tests
   - Evaluate whether the existing test coverage is sufficient

2. **T08: Documentation** (stigmer)
   - Update `docs/guides/federation/provision-federated-accounts.mdx`
   - Document JIT provisioning as the recommended approach for simple setups
   - Add "Quick Start" section showing 2-step setup (create IdP + enable JIT)
   - Update SDK code examples to show `getAccessToken` with platform JWT

## Context for Resume

- Proto changes are in stigmer on branch `feat/cli-modernization-2` (shared branch)
- stigmer-cloud T01+T02+T03 committed as `94690a52 feat(backend): add JIT provisioning to federated auth pipeline`
- stigmer-cloud T05 changes not yet committed (5 files: `ValidateJitFields.java`, `ValidateJitFieldsTest.java`, `IdentityProviderCreateHandler.java`, `IdentityProviderUpdateHandler.java`, `BUILD.bazel`)
- `ValidateJitFields` is a pure field-level validation step (no DB dependencies, unlike `ValidateSsoFields`)
- Pipeline placement: after `validateSsoFields`, before `normalizeIssuerUrls` in both create and update handlers
- Design decisions DD-001 through DD-004 are established

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

### 4. Key Files Modified in T05 (stigmer-cloud)
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/identityprovider/request/handler/ValidateJitFields.java` (NEW)
- `backend/services/stigmer-service/src/test/java/ai/stigmer/domain/iam/identityprovider/request/handler/ValidateJitFieldsTest.java` (NEW)
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/identityprovider/request/handler/IdentityProviderCreateHandler.java` (MODIFIED — added validateJitFields step)
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/identityprovider/request/handler/IdentityProviderUpdateHandler.java` (MODIFIED — added validateJitFields step)
- `backend/services/stigmer-service/BUILD.bazel` (MODIFIED — added validate_jit_fields_test target)

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
6. [ ] Verify T05 stigmer-cloud changes are committed
7. [ ] Continue with T07 or T08

## Quick Commands

After loading context:
- "Continue with T07" - Evaluate testing needs
- "Continue with T08" - Start documentation updates
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
