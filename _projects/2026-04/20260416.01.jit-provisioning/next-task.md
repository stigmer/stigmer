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
- **Last Session**: April 16, 2026 — T03 backend FederatedAutoProvisionerImpl completed
- **Active Task**: T03 complete, T04 is next

## Session Progress (April 16, 2026 — Session 3)

- Completed T03: Renamed SsoAutoProvisioner → FederatedAutoProvisioner and generalized provisioning logic
- Design decision DD-003: Reject authentication when tenant org not found (fail-closed, consistent with proto contract)
- Architecture decision: SSO and JIT have separate grant semantics — SSO always grants viewer on IdP's org (backward compat), JIT is fully configurable
- Renamed interface, exception, impl, and test (10 files updated, zero stale references)
- Added `OrganizationRepo` dependency for tenant org resolution via `findByExternalOrgId`
- Generalized `provision()` with `grantOrgRoleIfConfigured()`, `resolveTargetOrg()`, `resolveRole()`, and `grantOrgRole(accountId, orgId, roleName)`
- Added 7 new JIT-specific test cases covering no-grant, single-org viewer, single-org member, tenant org resolved, tenant org missing, claim missing, and SSO backward compat
- All 4 Bazel test targets pass, full compilation verified

## Next Steps

1. **T04: Backend — Update Auth Pipeline** (stigmer-cloud)
   - Review whether T04 scope is already covered by T02+T03 changes
   - T02 already updated `RequestCallerIdentityMapper` to use `shouldAutoProvision()`
   - T03 already updated the provisioner to handle both SSO and JIT
   - T04 may be a no-op or may involve wiring changes not yet done

2. **T05: Backend — IdP Validation** (stigmer-cloud)
   - Cross-field validation rules:
     - `auto_grant_on_org` requires `auto_provision_accounts`
     - `auto_grant_role` cannot be `owner`
     - `tenant_org_claim` requires `auto_provision_accounts`
     - SSO and JIT are mutually exclusive (or at least SSO overrides JIT fields)
   - Add validation in IdP create/update handlers

3. **T06: Backend — Tenant Org Resolution** (stigmer-cloud)
   - May be folded into T03 (tenant org resolution is now implemented)
   - Review if any remaining work exists

4. **T07: Testing** (stigmer-cloud)
5. **T08: Documentation** (stigmer)

## Context for Resume

- Proto changes are in stigmer on branch `feat/cli-modernization-2` (shared branch)
- stigmer-cloud changes are on `main` — T01+T02+T03 code changes not yet committed
- T03 renamed `SsoAutoProvisioner` → `FederatedAutoProvisioner` across the entire codebase (interface, exception, impl, test, mapper, interceptor, BUILD.bazel)
- `FederatedAutoProvisionerImpl` now takes 7 constructor dependencies (added `OrganizationRepo`)
- The provisioner's grant logic is branched: SSO always grants viewer on IdP's org; JIT checks `autoGrantOnOrg`, resolves target org (via `tenantOrgClaim` if set), resolves role (default viewer), and grants
- Tenant org resolution uses `OrganizationRepo.findByExternalOrgId(idpOrg, idpSlug, claimValue)` — the same query used by `OrganizationGetByExternalOrgIdHandler`
- `FederatedAutoProvisioningException` is caught by `GrpcRequestContextBuilderInterceptor` and surfaced as `UNAUTHENTICATED`
- Design decisions DD-001 (separate identity/authorization), DD-002 (no token-from-API-key), DD-003 (reject on missing tenant org) are established
- T04/T06 may be partially or fully covered by T02+T03 work — evaluate before starting

## Open Questions (from T01 plan, still unresolved)

1. **Rate limiting**: Should auto-provisioning have its own rate limit beyond `rate_limit_budget`?
2. **Profile sync**: Should subsequent authentications update profile data from JWT, or only on first creation?
3. **Personal org**: Should auto-provisioned federated accounts get a personal org?
4. **T04 scope**: Is T04 now a no-op given T02+T03 changes to the auth pipeline?
5. **T06 scope**: Is T06 now folded into T03 (tenant org resolution is implemented)?

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

### 4. Key Files Modified in T03 (stigmer-cloud)
- `backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/federation/FederatedAutoProvisioner.java` (NEW — renamed from SsoAutoProvisioner)
- `backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/federation/FederatedAutoProvisioningException.java` (NEW — renamed from SsoAutoProvisioningException)
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/identityprovider/federation/FederatedAutoProvisionerImpl.java` (NEW — renamed + generalized from SsoAutoProvisionerImpl)
- `backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/caller/RequestCallerIdentityMapper.java`
- `backend/libs/java/grpc/grpc-request/src/main/java/ai/stigmer/grpcrequest/interceptor/GrpcRequestContextBuilderInterceptor.java`
- `backend/services/stigmer-service/BUILD.bazel`

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
6. [ ] Evaluate T04 scope — may be a no-op
7. [ ] Continue with T04 or T05

## Quick Commands

After loading context:
- "Continue with T04" - Evaluate and start the next task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
