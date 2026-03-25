# Next Task: 20260325.01.auto-personal-org

## Current State
- **Status**: Tasks 1, 2, and 4 complete (proto change + server-side auto-creation + lazy backfill)
- **Last Session**: March 25, 2026 — Implemented Task 4 (lazy backfill on login)
- **Active Task**: None — ready for Task 3 (UI/UX) or Task 5 (testing)

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
1. Task 3: Web console updates — OrgGate fallback, OrgSwitcher personal org distinction (~0.5-1 day)
2. Task 5: Testing and validation — unit tests for slug gen, deletion guard, immutability, integration tests (~1 day)
3. Integration testing of the end-to-end signup flow + backfill flow

## Context for Resume
- Both repos are on branch `feat/auto-create-org`
- Sub-project `20260325.02.sp.on-behalf-of-grpc-channel` (on-behalf-of gRPC infrastructure) is COMPLETE
- The `OrganizationGrpcRepo` with `createOnBehalfOf()` was created in the sub-project
- The `isImpersonated` field on `RequestCallerIdentity` is a deviation from the original plan — needed because on-behalf-of calls set `isMachineAccount=false`
- Task 4 (lazy backfill) is complete — the workflow now ensures personal orgs exist for both new signups AND existing users on login

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-03/20260325.01.auto-personal-org/next-task.md`

## Sub-Projects

Active sub-projects spawned from this project:

- `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.02.sp.on-behalf-of-grpc-channel/next-task.md` - Build gRPC on-behalf-of infrastructure for in-process calls, enabling the system (machine account) to create resources attributed to a specific user identity. Solves the FGA ownership problem when system-created resources (personal orgs, execution contexts, default agent instances) get incorrectly owned by the machine account instead of the actual user.
