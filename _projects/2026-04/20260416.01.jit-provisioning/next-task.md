# Next Task: 20260416.01.jit-provisioning

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260416.01.jit-provisioning

**Description**: Add JIT (Just-In-Time) provisioning to IdentityProvider: auto_provision_accounts for identity creation, auto_grant_on_org for authorization, auto_grant_role for role selection, and tenant_org_claim for multi-tenant JWT claim mapping. Eliminates manual createFederatedAccount and IAM policy steps for platforms using federation.
**Goal**: Enable zero-friction federation where a platform JWT works end-to-end without any backend provisioning steps, while preserving full manual control as an opt-in for platforms that need it.
**Tech Stack**: Protobuf, Java/Spring (stigmer-cloud backend), TypeScript (SDK), Go (SDK), Python (SDK), MDX (docs)
**Components**: IdentityProvider proto (stigmer), FederatedAuthenticationToken (stigmer-cloud), FederatedAutoProvisionerImpl (stigmer-cloud), RequestCallerIdentityMapper (stigmer-cloud), IdP validation handlers (stigmer-cloud), SDK type generation (stigmer), federation docs (stigmer)

## Current State

- **Status**: in-progress (nearing completion)
- **Last Session**: April 16, 2026 — T08 Documentation completed
- **Active Task**: T08 complete, remaining follow-up items only

## Session Progress (April 16, 2026 — Session 6)

- Completed T08: Documentation — updated all 6 federation guide pages and 2 demo scenarios
- Updated `overview.mdx` with three provisioning modes, comparison table, path routing
- Added "Enable JIT provisioning" section to `register-identity-provider.mdx` with SDK examples in 4 languages
- Rewrote `authentication-flow.mdx` Step 7 for three outcomes (JIT/SSO/manual)
- Added JIT callouts to `provision-federated-accounts.mdx` and `grant-access.mdx`
- Added `tenantOrgClaim` section to `multi-tenant-setup.mdx` with resolution algorithm, SDK examples, DD-003 error handling
- Updated `DemoRegisterIdpPlayback` and `DemoAuthenticationFlowPlayback` demos

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
| T08 | Documentation: Federation guide + demos | Complete |

## Next Steps (Follow-up Items)

1. **Commit T07 stigmer-cloud changes** (still pending from session 5)
   - 6 files: BUILD.bazel registrations, ValidateSsoFieldsTest, IdentityProviderContextTest, getter fixes, delete handler test cleanup

2. **Regenerate demo narration audio**
   - `DemoRegisterIdpPlayback`: New step 5 (JIT config) and updated step 6 narration
   - `DemoAuthenticationFlowPlayback`: Updated step 5 narration
   - Run narration pipeline to generate MP3s from updated `steps.ts` narration scripts

3. **Deferred demo updates** (optional follow-up)
   - `DemoFederationOverviewTour`: Update for three provisioning modes
   - `DemoMultiTenantSetupPlayback`: Add JIT with `tenantOrgClaim` variant

## Context for Resume

- Proto changes are in stigmer on branch `feat/cli-modernization-2` (shared branch)
- T08 documentation committed in stigmer as `docs(federation): add JIT provisioning documentation across federation guide`
- stigmer-cloud T01+T02+T03 committed as `94690a52 feat(backend): add JIT provisioning to federated auth pipeline`
- stigmer-cloud T05 committed as `09976e9b feat(backend): add JIT field validation to IdentityProvider create/update`
- stigmer-cloud T07 changes still pending commit
- Design decisions DD-001 through DD-004 are established and reflected in documentation
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

### 4. Key Files Modified in T08 (stigmer)
- `docs/guides/federation/overview.mdx` (MODIFIED — three modes, comparison table, routing)
- `docs/guides/federation/register-identity-provider.mdx` (MODIFIED — JIT section, SDK examples, field table)
- `docs/guides/federation/authentication-flow.mdx` (MODIFIED — Step 7 rewrite, troubleshooting, summary)
- `docs/guides/federation/provision-federated-accounts.mdx` (MODIFIED — JIT callout)
- `docs/guides/federation/grant-access.mdx` (MODIFIED — auto-grant callout)
- `docs/guides/federation/multi-tenant-setup.mdx` (MODIFIED — tenantOrgClaim section)
- `site/src/components/docs/demos/scenarios/register-idp-playback/` (MODIFIED — JIT config step)
- `site/src/components/docs/demos/scenarios/authentication-flow-playback/` (MODIFIED — JIT resolve checks)

### 5. Key Files from T07 (stigmer-cloud, pending commit)
- `backend/services/stigmer-service/BUILD.bazel`
- `backend/libs/java/api/api-authentication/BUILD.bazel`
- `ValidateSsoFieldsTest.java` (NEW)
- `IdentityProviderContextTest.java` (NEW)
- `ValidateIssuerUniquenessTest.java` (FIXED)
- `IdentityProviderDeleteHandlerTest.java` (FIXED)

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
2. [ ] Check current task status in this file
3. [ ] Review design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.01.jit-provisioning/design-decisions/`
4. [ ] Verify T07 stigmer-cloud changes are committed
5. [ ] Address follow-up items (narration audio, deferred demos)

## Quick Commands

After loading context:
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
