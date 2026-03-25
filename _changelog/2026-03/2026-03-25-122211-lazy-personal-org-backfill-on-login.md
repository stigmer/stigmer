# Lazy Personal Org Backfill on Login

**Date**: March 25, 2026

## Summary

Added lazy backfill to ensure existing users who signed up before the personal org auto-creation feature receive a personal organization on their next login. The change is a single version-gated block in the existing `CreateIdentityAccountFromAuth0WorkflowImpl` Temporal workflow — no new infrastructure required.

## Problem Statement

Task 2 of the auto-personal-org project added personal org auto-creation during Auth0 signup (the `CreateIdentityAccountFromAuth0Workflow`). However, users who signed up *before* this feature was deployed would never receive a personal org because the creation logic only runs in the new-account path.

### Pain Points

- Existing users log in and hit the OrgGate ("no organization") screen despite the feature being deployed
- Two classes of users: new signups have personal orgs, existing users don't — inconsistent experience
- Without backfill, existing users would need to manually create an organization

## Solution

Piggyback on the existing Temporal workflow execution that already happens on every login. The auth0-webhooks-receiver Cloudflare Worker forwards both `ss` (Success Signup) and `s` (Success Login) events to the same `CreateIdentityAccountFromAuth0Workflow`. For existing users, the workflow finds the identity account and returns early — the backfill adds a personal org check before that return.

## Implementation Details

**Single file modified**: `CreateIdentityAccountFromAuth0WorkflowImpl.java`

In the existing-account early-return path, a version-gated block calls `personalOrgActivities.createPersonalOrganization()` with the user's identity account ID, Auth0 user ID, and email from the existing `IdentityAccount` proto (avoids an Auth0 Management API call).

Key design choices:
- **Temporal version key**: `"backfill-personal-org"` — independent from the existing `"add-personal-org"` in the new-account path. In-flight workflows are unaffected.
- **Email source**: `existing.getSpec().getEmail()` — already stored on the IdentityAccount, no external API call needed.
- **Idempotent**: `PersonalOrganizationActivitiesImpl` checks MongoDB for an existing personal org first. Once created, subsequent logins hit a fast query and return immediately.
- **Non-fatal**: Wrapped in try/catch. If backfill fails, the user can still log in normally. Retries on next login.
- **Machine accounts skipped**: `IsMachineAccountVerifier.verify()` — M2M clients don't get personal orgs.

## Benefits

- Zero new infrastructure — reuses existing Temporal activities, worker registration, and `createOnBehalfOf` gRPC pattern
- Self-correcting — catches any edge case where personal org creation failed during signup (the warn log in Step 7 already referenced this: "will be backfilled on next login")
- Eventually consistent — all active users get personal orgs on their next login without a migration script
- Negligible ongoing cost — after backfill, subsequent logins execute one sub-millisecond MongoDB query

## Impact

- **Existing users**: Seamlessly receive a personal organization on next login
- **Platform consistency**: All active users will have personal orgs, enabling the removal of the OrgGate "no organization" fallback for cloud users
- **Operational**: No migration script to run, no manual intervention required

## Related Work

- [Personal Org Auto-Creation](2026-03-25-120817-personal-org-auto-creation.md) — Task 2: server-side auto-creation during signup
- [On-Behalf-Of gRPC Impersonation Infrastructure](2026-03-25-113851-on-behalf-of-grpc-impersonation-infrastructure.md) — Foundation for `createOnBehalfOf`
- [Wire On-Behalf-Of Impersonation Call Sites](2026-03-25-121903-wire-on-behalf-of-impersonation-call-sites.md) — Wiring impersonation into all createAsSystem call sites

---

**Status**: ✅ Production Ready
