# Personal Organization Auto-Creation

**Date**: March 25, 2026

## Summary

Implemented server-side auto-creation of personal organizations during Auth0 user signup, eliminating the manual org creation step from onboarding. New users now land directly in their workspace — like GitHub personal accounts. This builds on the on-behalf-of gRPC impersonation infrastructure (completed earlier) to ensure correct FGA ownership attribution.

## Problem Statement

When a new user signed up via Auth0, they were created as an identity account but had no organization. They had to manually create one before using any platform features. This added friction to the onboarding flow and was inconsistent with the user mental model — every platform (GitHub, GitLab, npm) gives you a personal namespace automatically.

### Pain Points

- New users hit an empty state with no org after signup — blocked from doing anything
- Manual org creation added an unnecessary onboarding step
- No default workspace for personal resources (agents, environments, sessions)
- Platform-managed org creation (via IdentityProvider) existed, but personal org auto-creation did not

## Solution

Added `bool is_personal = 6` to `OrganizationSpec` proto and implemented a Temporal activity that creates a personal organization on behalf of the user during identity account provisioning. The organization is created via the on-behalf-of gRPC channel so the user (not the machine account) becomes the FGA owner.

## Implementation Details

### Proto Change (stigmer repo)

Added `is_personal` field to `OrganizationSpec` in `spec.proto` with documentation noting it is immutable after creation and server-set only. Regenerated stubs across Go, Java, TypeScript, Python, and Dart.

### Slug Generator

`PersonalOrgSlugGenerator` — pure utility that converts email addresses to valid org slugs matching the CEL constraints in `api.proto` (lowercase, letters/numbers/hyphens, 2-15 chars, starts with letter). Includes `appendConflictSuffix()` for collision handling.

### Temporal Activities

Created a separate `PersonalOrganizationActivities` interface (following Temporal best practice of focused interfaces) with an idempotent `createPersonalOrganization()` method. The implementation:
- Queries MongoDB for existing personal org (idempotency check via `createdBy.id`)
- Resolves display name from Auth0 user profile (fallback to email local part)
- Generates slug from email
- Creates org via `OrganizationGrpcRepo.createOnBehalfOf()` — user becomes FGA owner
- Retries with random suffix on slug conflicts (up to 3 times)

### Workflow Update

Added versioned step 6 to `CreateIdentityAccountFromAuth0WorkflowImpl` using `Workflow.getVersion("add-personal-org")` for backward compatibility with in-flight workflows. Failure is non-fatal — logs a warning and continues (identity account is the primary resource). Machine accounts are skipped.

### Handler Guards

- **Update guard**: Added `is_personal` to `EnforceImmutableFields` — rejects changes and preserves value from existing state
- **Delete guard**: New `RejectPersonalOrgDeletion` pipeline step returns `FAILED_PRECONDITION` when attempting to delete a personal org
- **Create guard**: New `NormalizeIsPersonal` pipeline step strips `is_personal=true` from non-system callers (defense-in-depth)

### Impersonation Flag

Added `isImpersonated` boolean to `RequestCallerIdentity` (with `@Builder.Default = false`). Set to `true` by the interceptor during on-behalf-of override. This was needed because the plan assumed impersonated calls would appear as "operator" to handlers, but the interceptor overrides the caller to the impersonated user (`isMachineAccount=false`). The create guard uses `isMachineAccount || isImpersonated` to allow system-initiated calls.

## Benefits

- Zero-friction onboarding — new users get a workspace immediately after signup
- Correct FGA ownership — personal org is owned by the user, not the machine account
- Idempotent and fault-tolerant — Temporal retries handle transient failures
- Defense-in-depth — three guards prevent tampering with `is_personal` field
- Backward compatible — versioned workflow step, in-flight workflows unaffected

## Impact

- **New users**: Immediately get a personal organization on signup
- **Existing users**: Unaffected (backfill can be done via Task 4 — lazy creation on login)
- **Platform builders**: `is_personal` field available in Organization proto for UI differentiation
- **Auth pipeline**: One additional Temporal activity step (~200ms) added to signup workflow

## Related Work

- [On-behalf-of gRPC impersonation infrastructure](2026-03-25-113851-on-behalf-of-grpc-impersonation-infrastructure.md) — prerequisite sub-project
- [FGA personal resources auth model](2026-03-19-134605-fga-personal-resources-auth-model.md) — FGA modeling for personal resources
- [Org onboarding gate](2026-03-22-180026-org-onboarding-gate.md) — UI that will benefit from automatic org existence

---

**Status**: ✅ Production Ready (server-side implementation complete; UI tasks remaining in project)
**Timeline**: ~4 hours (including on-behalf-of sub-project completed earlier)
