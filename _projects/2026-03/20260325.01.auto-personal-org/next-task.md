# Next Task: 20260325.01.auto-personal-org

## Current State
- **Status**: Tasks 1 + 2 complete (proto change + server-side auto-creation)
- **Last Session**: March 25, 2026 — Implemented all 7 tasks from the plan
- **Active Task**: None — all planned tasks completed

## Session Progress (2026-03-25)

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

### Files Modified

**stigmer repo:**
- `apis/ai/stigmer/tenancy/organization/v1/spec.proto` — added `is_personal` field
- All generated stubs (Go, Java, TS, Python, MCP server, SDKs)

**stigmer-cloud repo:**
- `RequestCallerIdentity.java` — added `isImpersonated` field
- `GrpcRequestContextBuilderInterceptor.java` — sets `isImpersonated=true` on on-behalf-of override
- `IdentityAccountTemporalWorkerConfig.java` — registers `PersonalOrganizationActivitiesImpl`
- `CreateIdentityAccountFromAuth0WorkflowImpl.java` — versioned personal org creation step
- `OrganizationCreateHandler.java` — `NormalizeIsPersonal` pipeline step
- `OrganizationDeleteHandler.java` — `RejectPersonalOrgDeletion` pipeline step
- `OrganizationUpdateHandler.java` — `is_personal` immutability in `EnforceImmutableFields`
- NEW: `PersonalOrgSlugGenerator.java`
- NEW: `PersonalOrganizationActivities.java`
- NEW: `PersonalOrganizationActivitiesImpl.java`
- NEW: `CreatePersonalOrgInput.java`
- Generated stubs (Go, Java, TS, Python, Dart)

## Next Steps
1. Remaining tasks from `tasks.md` (Tasks 3-6) — UI/UX changes for org gate, org switcher, etc.
2. Task 4: Lazy backfill on login — safety net for users who signed up before this change
3. Integration testing of the end-to-end signup flow

## Context for Resume
- Both repos are on branch `feat/auto-create-org`
- Sub-project `20260325.02.sp.on-behalf-of-grpc-channel` (on-behalf-of gRPC infrastructure) is COMPLETE
- The `OrganizationGrpcRepo` with `createOnBehalfOf()` was created in the sub-project
- The `isImpersonated` field on `RequestCallerIdentity` is a deviation from the original plan — needed because on-behalf-of calls set `isMachineAccount=false`

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-03/20260325.01.auto-personal-org/next-task.md`

## Sub-Projects

Active sub-projects spawned from this project:

- `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260325.02.sp.on-behalf-of-grpc-channel/next-task.md` - Build gRPC on-behalf-of infrastructure for in-process calls, enabling the system (machine account) to create resources attributed to a specific user identity. Solves the FGA ownership problem when system-created resources (personal orgs, execution contexts, default agent instances) get incorrectly owned by the machine account instead of the actual user.
