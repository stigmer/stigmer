# Next Task: 20260325.01.auto-personal-org

## Current State
- **Status**: Tasks 1–5 complete (proto + server-side + web console + lazy backfill + automated tests)
- **Last Session**: March 25, 2026 — Implemented Task 5 (automated tests)
- **Active Task**: None — ready for manual validation (Task 5 subtasks 7–8)

## Session Progress (2026-03-25, Session 4)

### Accomplished
- Implemented Task 5: automated unit and integration tests for all auto-personal-org components
- Created 5 new test files + modified 1 existing test file in `stigmer-cloud`
- Total: ~43 test cases covering slug generation, deletion guard, immutability enforcement, NormalizeIsPersonal guard, Temporal activity implementation, and Temporal workflow orchestration

### Test Files Created/Modified

**stigmer-cloud repo:**
- `...organization/service/PersonalOrgSlugGeneratorTest.java` (NEW) — 14 tests: deterministic transformations (standard email, special chars, uppercase, leading digits, truncation, no-@ input), fallback/padding (null, blank, empty, only special chars, single char), appendConflictSuffix (short/long slugs, trailing hyphens, randomness), structural invariants across all inputs
- `...organization/request/handler/OrganizationUpdateHandlerImmutabilityTest.java` (MODIFIED) — +4 tests in new `@Nested` class: rejects `false→true` mutation, no false positive on proto3 default, preserves `is_personal=true` and `false` from existing; doc comment updated from "three" to "four" immutable fields; added `buildPersonalOrg()` helper
- `...organization/request/handler/OrganizationDeleteHandlerRejectPersonalOrgTest.java` (NEW) — 3 tests: FAILED_PRECONDITION on personal org, success on team org, null-safety
- `...organization/request/handler/OrganizationCreateHandlerNormalizeIsPersonalTest.java` (NEW) — 5 tests: no-op for non-personal, stripping from regular users, allowance for machine accounts, impersonated callers, both flags combined
- `...identityaccount/temporal/activities/PersonalOrganizationActivitiesImplTest.java` (NEW) — 10 tests: idempotency (existing org check + MongoDB query criteria), proto construction, display name resolution (4 fallback paths), slug conflict retry (success/exhaustion/non-ALREADY_EXISTS propagation)
- `...identityaccount/temporal/workflows/CreateIdentityAccountFromAuth0WorkflowTest.java` (NEW) — 7 tests using TestWorkflowEnvironment: new signup happy path + machine account skip + non-fatal failure; backfill on login + machine account skip + non-fatal failure; idempotency

### Key Decisions
- **IDE-first test pattern**: Followed existing codebase convention (52 of 57 tests are IDE-only, not registered in BUILD.bazel). Mockito and temporal-testing are not in MODULE.bazel. Bazel registration is a separate task if CI coverage is desired.
- **Pattern-based assertions for random paths**: `PersonalOrgSlugGenerator` uses `ThreadLocalRandom` for suffixes — tests verify structure (regex + length bounds) rather than exact values.
- **Asymmetric immutability check documented**: The `is_personal` immutability check only detects `false→true` (not `true→false`) because proto3 default `false` is indistinguishable from "not set". The preservation step is the actual guard. Tests explicitly document this design.
- **TestWorkflowEnvironment for workflow tests**: `Workflow.getVersion()` returns latest version in test env, so both version-gated paths (backfill + new-account) execute in all tests.

## Session Progress (2026-03-25, Session 3)

### Accomplished
- Implemented Task 3: web console updates for auto-personal-org
- Added provisioning-aware `ProvisioningState` to `OrgGate` — personalized "Welcome, {name}! Setting up your workspace..." screen shown during the async gap between OIDC redirect and Temporal workflow completion (OIDC mode only)
- Added auto-retry loop: polls `findMyOrganizations()` every 2 seconds for up to 10 seconds before falling back to manual `CreateOrganizationForm`
- Updated `OrgSwitcher` to visually distinguish personal orgs: `User` icon for personal orgs, `Building2` for team orgs, grouped with separator

### Key Decisions
- **Provisioning state is OIDC-only**: OSS users (`authMode === "disabled"`) see the existing `OnboardingState` with manual create form immediately. Cloud users get the provisioning wait because the personal org is being created server-side.
- **Errors absorbed during provisioning**: Transient errors (identity not yet created) are expected during the 2-10 second provisioning window. The `isProvisioning` render check takes priority over `isLoading` and `error` to prevent flickering.
- **Ref guard prevents re-entry**: `provisioningAttemptedRef` ensures provisioning is only attempted once per component lifecycle. After the 10-second timeout, the existing error/empty state takes over.
- **Console-only changes**: No SDK (`@stigmer/react`) changes needed. `OrgGate`, `OrgProvider`, and `OrgSwitcher` are all Console-specific concerns. `CreateOrganizationForm` (SDK) unchanged.
- **Auth mode detection**: Uses `getRuntimeConfig().authMode` (synchronously available after `ConfigGate`) rather than extending the `AuthState` interface.

### Files Modified

**stigmer repo:**
- `client-apps/web/src/components/auth/OrgGate.tsx` — added `ProvisioningState` component, provisioning retry logic with 10s timeout, auth mode detection via `getRuntimeConfig`
- `client-apps/web/src/components/layout/OrgSwitcher.tsx` — personal org icon distinction (`User` vs `Building2`), grouped dropdown (personal first, separator, team orgs)

## Session Progress (2026-03-25, Session 2)

### Accomplished
- Implemented Task 4: lazy personal org backfill on login
- Added version-gated backfill check to the existing-account early-return path in `CreateIdentityAccountFromAuth0WorkflowImpl`
- The backfill piggybacks on existing infrastructure — the auth0-webhooks-receiver Worker already forwards login events (`s`) to the same Temporal workflow, which finds the existing identity and returns early. The backfill adds a personal org check before that return.

### Key Decisions
- **No new infrastructure**: The backfill reuses `PersonalOrganizationActivities` (already registered with Temporal worker), `createOnBehalfOf`, and the existing idempotency in `PersonalOrganizationActivitiesImpl`.
- **Email source**: Uses `existing.getSpec().getEmail()` from the IdentityAccount proto (field 2) — avoids an Auth0 Management API call. This is the key difference from the new-account path (Step 7) which loads email from Auth0 in Step 4.
- **Separate Temporal version key**: `"backfill-personal-org"` is distinct from the existing `"add-personal-org"` in Step 7. Each version gate is independent — in-flight workflows continue unaffected.
- **Non-fatal**: Wrapped in try/catch. If backfill fails, the user can still log in normally. Retries on next login.

### Key Discovery
- The auth0-webhooks-receiver Cloudflare Worker forwards **both** `ss` (Success Signup) **and** `s` (Success Login) events to the same `CreateIdentityAccountFromAuth0Workflow`. Every login already triggers a Temporal workflow execution (with unique timestamp-based workflow ID). The workflow checks if the identity account exists and returns early — the backfill is just one more step before that return.

### Files Modified

**stigmer-cloud repo:**
- `CreateIdentityAccountFromAuth0WorkflowImpl.java` — added version-gated backfill check in existing-account early-return path (lines 86-102), renumbered step comments (Steps 3-7)

## Previous Session Progress (2026-03-25, Session 1)

### Accomplished
- Added `bool is_personal = 6` to `OrganizationSpec` proto + regenerated stubs in both repos
- Created `PersonalOrgSlugGenerator` — email-to-slug sanitization with conflict suffix handling
- Created `PersonalOrganizationActivities` interface + `CreatePersonalOrgInput` DTO + `PersonalOrganizationActivitiesImpl` with idempotent creation via `createOnBehalfOf`
- Updated `CreateIdentityAccountFromAuth0WorkflowImpl` with versioned personal org creation step (skips machine accounts, failure is non-fatal)
- Registered `PersonalOrganizationActivitiesImpl` with Temporal worker in `IdentityAccountTemporalWorkerConfig`
- Added `is_personal` immutability to `OrganizationUpdateHandler.EnforceImmutableFields`
- Added `RejectPersonalOrgDeletion` step to `OrganizationDeleteHandler` pipeline
- Added `NormalizeIsPersonal` step to `OrganizationCreateHandler` — strips `is_personal=true` from non-system callers
- Added `isImpersonated` field to `RequestCallerIdentity` + set in interceptor on-behalf-of path (needed for create guard to allow impersonated calls)

### Key Decisions
- **isImpersonated flag**: The plan assumed on-behalf-of calls would appear as "operator" to handlers. In reality, the interceptor overrides the caller to the impersonated user (`isMachineAccount=false`). Added `isImpersonated` to `RequestCallerIdentity` to enable the create guard to correctly allow `is_personal=true` for system-initiated impersonated calls while stripping it from direct user API calls.
- **Machine accounts**: Skipped — only human Auth0 signups get personal orgs. `IsMachineAccountVerifier.verify()` check in workflow.
- **Idempotency**: Activity queries MongoDB for existing personal org by `spec.isPersonal=true` AND `status.audit.createdBy.id` matching the identity account ID.

## Next Steps
1. Manual validation: web console flow (sign up -> provisioning screen -> land in workspace)
2. Manual validation: CLI flow (login -> context auto-set to personal org)
3. Optional: Register test targets in `BUILD.bazel` + add Mockito/temporal-testing to `MODULE.bazel` for Bazel CI coverage

## Context for Resume
- Both repos are on branch `feat/auto-create-org`
- Sub-project `20260325.02.sp.on-behalf-of-grpc-channel` (on-behalf-of gRPC infrastructure) is COMPLETE
- Tasks 1–5 are all complete (automated tests done, manual validation remaining)
- 43 automated test cases across 6 test files in stigmer-cloud
- Tests follow IDE-first pattern (not registered in BUILD.bazel — same as 52 of 57 existing tests)
- The `isImpersonated` field on `RequestCallerIdentity` is a deviation from the original plan — needed because on-behalf-of calls set `isMachineAccount=false`

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-03/20260325.01.auto-personal-org/next-task.md`

## Sub-Projects

Active sub-projects spawned from this project:

- `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.02.sp.on-behalf-of-grpc-channel/next-task.md` - Build gRPC on-behalf-of infrastructure for in-process calls, enabling the system (machine account) to create resources attributed to a specific user identity. Solves the FGA ownership problem when system-created resources (personal orgs, execution contexts, default agent instances) get incorrectly owned by the machine account instead of the actual user.
