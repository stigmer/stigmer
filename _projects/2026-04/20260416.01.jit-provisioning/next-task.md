# Next Task: 20260416.01.jit-provisioning

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260416.01.jit-provisioning

**Description**: Add JIT (Just-In-Time) provisioning to IdentityProvider: auto_provision_accounts for identity creation, auto_grant_on_org for authorization, auto_grant_role for role selection, and tenant_org_claim for multi-tenant JWT claim mapping. Eliminates manual createFederatedAccount and IAM policy steps for platforms using federation.
**Goal**: Enable zero-friction federation where a platform JWT works end-to-end without any backend provisioning steps, while preserving full manual control as an opt-in for platforms that need it.
**Tech Stack**: Protobuf, Java/Spring (stigmer-cloud backend), TypeScript (SDK), Go (SDK), Python (SDK), MDX (docs)
**Components**: IdentityProvider proto (stigmer), FederatedAuthenticationToken (stigmer-cloud), SsoAutoProvisionerImpl (stigmer-cloud), RequestCallerIdentityMapper (stigmer-cloud), IdP validation handlers (stigmer-cloud), SDK type generation (stigmer), federation docs (stigmer)

## Current State

- **Status**: in-progress
- **Last Session**: April 16, 2026 — T01 proto implementation completed
- **Active Task**: T01 complete, T02 is next

## Session Progress (April 16, 2026)

- Completed T01: Added four JIT provisioning fields to `IdentityProviderSpec` proto (fields 9-12)
- Fields: `auto_provision_accounts` (bool), `auto_grant_on_org` (bool), `auto_grant_role` (IamRole), `tenant_org_claim` (string)
- Updated message-level proto documentation to cover all three provisioning modes (Manual, JIT, SSO)
- Added two new YAML examples (JIT single-org, JIT multi-tenant)
- Ran `make codegen` in stigmer — all SDK stubs regenerated cleanly (Go, TS, Python, Java, MCP server)
- Ran `make protos` in stigmer-cloud — all language stubs regenerated cleanly (Java, Dart, TS, Go, Python)
- Verified generated fields across all four languages with correct types
- `buf lint` passed cleanly

## Next Steps

1. **T02: Backend — FederatedAuthenticationToken** (stigmer-cloud)
   - Add `autoProvisionAccounts`, `autoGrantOnOrg`, `autoGrantRole`, `tenantOrgClaim` fields to `FederatedAuthenticationToken.java`
   - Update `FederatedJwtAuthenticationProvider.java` to pass new spec fields when constructing the token

2. **T03: Backend — Generalize Auto-Provisioner** (stigmer-cloud)
   - Rename `SsoAutoProvisionerImpl` to `FederatedAutoProvisionerImpl`
   - Split `provision()` into `createAccount()` + `grantOrgRole()`
   - Add tenant org resolution when `tenantOrgClaim` is set

3. **T04: Backend — Update Auth Pipeline** (stigmer-cloud)
4. **T05: Backend — IdP Validation** (stigmer-cloud)
5. **T06: Backend — Tenant Org Resolution** (stigmer-cloud)
6. **T07: Testing** (stigmer-cloud)
7. **T08: Documentation** (stigmer)

## Context for Resume

- Proto changes are in stigmer on branch `feat/cli-modernization-2` (shared branch — JIT changes not yet on their own branch)
- stigmer-cloud changes are on `main` (generated stubs only, not yet committed)
- The `IamRole` enum import was added: `import "ai/stigmer/iam/v1/enum.proto"`
- Cross-field validation rules (e.g., `auto_grant_on_org` requires `auto_provision_accounts`) are NOT in the proto — they are deferred to T05 (service-layer validation)
- Design decisions DD-001 (separate identity/authorization) and DD-002 (no token-from-API-key) are established

## Open Questions (from T01 plan, still unresolved)

1. **Rate limiting**: Should auto-provisioning have its own rate limit beyond `rate_limit_budget`?
2. **Profile sync**: Should subsequent authentications update profile data from JWT, or only on first creation?
3. **Personal org**: Should auto-provisioned federated accounts get a personal org?
4. **tenant_org_claim edge cases**: What if the JWT has the claim but the org doesn't exist? What if a user's JWT contains different tenant claims across requests?

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
6. [ ] Continue with T02

## Quick Commands

After loading context:
- "Continue with T02" - Start the next task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
