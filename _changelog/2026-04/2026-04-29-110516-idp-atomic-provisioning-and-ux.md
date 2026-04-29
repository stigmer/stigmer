# IDP Federated Auth: Atomic Provisioning and End-to-End UX

**Date**: April 29, 2026

## Summary

Fixed a critical silent failure in the federated identity provisioning flow where auto-granted org roles could fail without surfacing an error, leaving users authenticated but unable to access any resources. Introduced atomic provisioning with compensating rollback, structured observability, and frontend improvements that give org admins visibility into IDP status and auto-provisioned members.

## Problem Statement

When a user authenticates via a third-party Identity Provider (Auth0, Okta, etc.) with JIT auto-provisioning enabled, the system creates a federated identity account and grants an organization role. If the role grant failed (e.g., transient FGA error), the exception was silently swallowed. The user's account existed but had no org access — they could authenticate but couldn't view or execute any agents, with no signal to the admin.

### Pain Points

- `grantOrgRole` in `FederatedAutoProvisionerImpl` caught and logged all exceptions without propagating, creating orphaned accounts with no org access
- Subsequent authentications resolved the existing (broken) account from cache/DB without re-attempting the grant
- No admin UI showed whether auto-provisioned members had successfully received their org role
- The Org Profile page had zero indication that IDPs were configured for the org
- The IDP creation wizard offered no post-setup guidance

## Solution

**Backend (stigmer-cloud):** Made provisioning atomic via compensating rollback. If the org role grant fails after account creation, the account is rolled back (deleted from MongoDB, FGA tuples cleaned up, Redis cache evicted). The next authentication attempt triggers a fresh provisioning cycle. This avoids orphaned accounts entirely.

**Frontend (stigmer):** Added IDP visibility on the Org Profile page, a post-creation success step in the IDP Wizard with contextual guidance, and a federated members indicator on the Members settings page.

## Implementation Details

### Backend — Atomic Provisioning

**`FederatedAutoProvisionerImpl.java`** (stigmer-cloud):
- `provision()` now wraps `grantOrgRoleIfConfigured` in a try-catch. On failure, calls `rollbackAccount()` then throws `FederatedAutoProvisioningException`
- `grantOrgRole()` no longer swallows exceptions — they propagate to `provision()`
- New `rollbackAccount()` method: cleans up IAM policies (FGA), deletes account from MongoDB, evicts Redis cache — each step independently guarded so partial failures don't block others
- All log messages use structured `federated.provision.*` event names for filtering and alerting

**`FederatedAutoProvisionerImplTest.java`** (stigmer-cloud):
- Updated `roleGrantFailure` test to verify rollback behavior (cleanup + delete + cache eviction)
- Added `roleGrantFailure_rollbackDeleteFails_stillThrows` for degraded rollback
- Updated tenant org tests to verify rollback on claim resolution failures

### Frontend — IDP Visibility

**`OrgProfilePanel.tsx`** (sdk/react):
- Added `IdentityProvidersSummary` section showing linked IDPs with SSO/JIT badges
- Shows "set up federated authentication" link when no IDPs configured

**`IdentityProviderWizard.tsx`** (sdk/react):
- Added `"success"` wizard step with contextual "what happens next" guidance
- Guidance adapts based on provisioning config (SSO, JIT+grant, JIT-only, manual trust)

**`MembersSection.tsx`** (sdk/react):
- Shows contextual note when org has IDPs with auto-provisioning: "Members may appear here automatically when users authenticate via federated identity"

## Benefits

- Users no longer get silently orphaned after a transient grant failure — the auth fails clearly and retries cleanly
- Org admins can see IDP configuration directly on the Org Profile page
- Post-IDP-setup guidance reduces confusion about what happens next
- Members page provides context about auto-provisioned users
- Structured logging enables operational alerting on provisioning failures

## Impact

- **Platform builders** using IDP federation get a reliable provisioning flow
- **Org admins** get visibility into IDP status without navigating to a separate settings page
- **Operations** can monitor and alert on provisioning failures via structured log events
- **Cloud-only** — OSS `stigmer-server` does not implement IDP authentication

## Related Work

- IDP Federation feature (T02 in the identity provider implementation series)
- OpenFGA authorization model (organization role propagation to child resources)

---

**Status**: Production Ready
**Timeline**: Single session
