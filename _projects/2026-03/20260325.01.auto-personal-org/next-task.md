# Next Task: 20260325.01.auto-personal-org

## Current State
- **Status**: Tasks 1, 2, and 4 complete. Task 3 planned and ready to implement.
- **Last Session**: March 25, 2026 (Session 3) — Design/planning session for Task 3 (Web Console updates)
- **Active Task**: Task 3 — Web console updates (OrgGate provisioning state + OrgSwitcher personal org distinction)

## Session Progress (2026-03-25, Session 3 — Planning)

### Accomplished
- Deep-dived into the async timing problem between Auth0 OIDC redirect and Temporal workflow completion
- Mapped the full signup flow: Auth0 redirect → OIDC callback → OrgProvider load → race condition with webhook-triggered Temporal workflow
- Identified that `findMyOrganizations()` can return empty for cloud users because the personal org hasn't been created yet (OIDC redirect and Auth0 webhook are independent channels)
- Explored the full web console architecture: OrgGate, OrgProvider, OrgSwitcher, auth flow, provider hierarchy
- Designed a provisioning-aware OrgGate with a new `ProvisioningState` between Loading and Onboarding
- Confirmed all changes are Console-only (`client-apps/web`) — no SDK (`@stigmer/react`) changes needed

### Key Design Decisions
- **Provisioning state**: In OIDC mode, when `findMyOrganizations()` returns empty, show a personalized "Setting up your workspace..." screen instead of the manual CreateOrganizationForm. Auto-retry every 2 seconds.
- **10-second timeout**: After 10 seconds of retries, fall back to the existing OnboardingState with CreateOrganizationForm as a genuine safety net.
- **OSS vs Cloud bifurcation**: The "no orgs" state has different meanings: OIDC mode = transient (provisioning in progress), disabled mode = permanent (user must create manually). OrgGate now handles these separately.
- **Auth mode detection**: Use `getRuntimeConfig().authMode` (available synchronously after ConfigGate) — no changes to `AuthState` interface needed.
- **Flicker prevention**: `isProvisioning` check takes priority over `isLoading` in render conditions, so `refresh()` calls during provisioning don't cause visual flickering between spinner and provisioning screen.
- **Error absorption during provisioning**: Transient errors during the provisioning window are absorbed (expected — identity may not exist yet). Errors surface only after timeout via the existing ErrorState.
- **OrgSwitcher personal org distinction**: Personal orgs get `User` icon (lucide) instead of `Building2`, listed first with separator before team orgs. Mirrors GitHub's namespace switcher pattern.

### Files to Modify (implementation)
- `client-apps/web/src/components/auth/OrgGate.tsx` — add ProvisioningState, provisioning retry logic, auth mode detection
- `client-apps/web/src/components/layout/OrgSwitcher.tsx` — personal org icon distinction, grouped dropdown list

### No Files Modified This Session
This was a planning-only session. No code changes were made.

## Previous Session Progress (2026-03-25, Session 2)

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
1. **Task 3 (implement)**: Execute the approved plan — OrgGate ProvisioningState + OrgSwitcher personal org distinction
2. Task 5: Testing and validation — unit tests for slug gen, deletion guard, immutability, integration tests (~1 day)
3. Integration testing of the end-to-end signup flow + backfill flow

## Context for Resume
- Both repos are on branch `feat/auto-create-org`
- Sub-project `20260325.02.sp.on-behalf-of-grpc-channel` (on-behalf-of gRPC infrastructure) is COMPLETE
- The `OrganizationGrpcRepo` with `createOnBehalfOf()` was created in the sub-project
- The `isImpersonated` field on `RequestCallerIdentity` is a deviation from the original plan — needed because on-behalf-of calls set `isMachineAccount=false`
- Task 4 (lazy backfill) is complete — the workflow now ensures personal orgs exist for both new signups AND existing users on login
- **Task 3 plan is approved** — ready to implement. Key design: ProvisioningState in OrgGate (OIDC mode, 2s retry, 10s timeout), personal org icon in OrgSwitcher

### Task 3 Implementation Plan (Approved)

**OrgGate (`client-apps/web/src/components/auth/OrgGate.tsx`)**:
- Add `isProvisioning` local state — entered when `!isLoading && orgs.length === 0 && authMode === "oidc"`
- Auto-retry `refresh()` every 2s via `setInterval`, timeout after 10s via `setTimeout`
- `isProvisioning` takes render priority over `isLoading` (prevents flicker during retries)
- New `ProvisioningState` component: personalized with `useAuth().user` (name/email from JWT), "Setting up your workspace..." message, GateHeader with sign-out
- On timeout: exit provisioning, existing state takes over (OnboardingState or ErrorState)
- Detect OIDC mode via `getRuntimeConfig().authMode`

**OrgSwitcher (`client-apps/web/src/components/layout/OrgSwitcher.tsx`)**:
- Import `User` from lucide-react
- Split orgs into `personalOrgs` and `teamOrgs` by `org.spec?.isPersonal`
- Trigger icon: `User` when personal org active, `Building2` when team org active
- Dropdown: personal orgs first, separator, team orgs, separator, "Create organization"
- No changes to CreateOrganizationForm (always creates team orgs)

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-03/20260325.01.auto-personal-org/next-task.md`

## Sub-Projects

Active sub-projects spawned from this project:

- `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.02.sp.on-behalf-of-grpc-channel/next-task.md` - Build gRPC on-behalf-of infrastructure for in-process calls, enabling the system (machine account) to create resources attributed to a specific user identity. Solves the FGA ownership problem when system-created resources (personal orgs, execution contexts, default agent instances) get incorrectly owned by the machine account instead of the actual user.
