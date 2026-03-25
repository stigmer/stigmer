# Web Console: Provisioning-Aware Loading and Personal Org Distinction

**Date**: March 25, 2026

## Summary

Added a provisioning-aware loading state to `OrgGate` that handles the async race between OIDC login redirect and server-side personal org creation, and updated `OrgSwitcher` to visually distinguish personal orgs from team orgs. Cloud users now see a personalized "Welcome, {name}!" screen instead of the manual create form during the 2-10 second provisioning window after signup.

## Problem Statement

With auto-personal-org creation (Tasks 1, 2, 4), the personal organization is created asynchronously via a Temporal workflow triggered by an Auth0 webhook. The OIDC redirect and webhook are independent channels — there is a race where `findMyOrganizations()` returns empty for a cloud user whose personal org is still being provisioned.

### Pain Points

- Cloud users saw the "Welcome to Stigmer / Create Organization" manual form during the 2-10 second race, implying they needed to create an org manually (they don't)
- If users created one manually during the race, they'd end up with two orgs
- The manual form would "flash" briefly then disappear when the personal org arrived — a classic "flash of wrong state" anti-pattern
- No visual distinction between personal and team orgs in the sidebar switcher

## Solution

Bifurcated the "no orgs" state in `OrgGate` based on auth mode (OIDC vs disabled), and added personal org awareness to the `OrgSwitcher` dropdown.

## Implementation Details

### OrgGate: New `ProvisioningState` (OIDC only)

The component now has a four-state machine instead of three:

1. **Loading** — spinner while `findMyOrganizations()` is in flight (unchanged)
2. **Provisioning** (new, OIDC only) — personalized welcome screen with auto-retry
3. **Error** — retry prompt (unchanged)
4. **Onboarding** — manual `CreateOrganizationForm` (unchanged, now serves as fallback)

Key mechanics:
- Enters provisioning when initial load returns empty in OIDC mode (detected via `getRuntimeConfig().authMode`)
- Polls `refresh()` every 2 seconds for up to 10 seconds
- `isProvisioning` render check takes priority over `isLoading`/`error` to prevent flickering during retries
- `provisioningAttemptedRef` prevents re-entry after timeout
- After timeout, falls back to existing error/onboarding state
- OSS users (`authMode === "disabled"`) see the existing flow unchanged

### OrgSwitcher: Personal Org Visual Distinction

- Trigger icon: `User` (lucide) for personal orgs, `Building2` for team orgs
- Dropdown: personal orgs listed first, separator, then team orgs
- Each radio item has an icon prefix matching its type

## Benefits

- Cloud signup flow is seamless — no "flash of wrong state"
- Personalized welcome sets a professional first impression
- 10-second timeout with fallback ensures no user is stuck
- OSS flow is completely unchanged
- Personal orgs are visually identifiable at a glance in the sidebar

## Impact

- **Cloud users**: Smoother signup-to-app transition
- **All users**: Clear visual distinction between personal and team orgs in the switcher
- **OSS users**: No change — existing onboarding flow preserved
- **SDK**: No changes — all modifications are Console-only (`client-apps/web`)

## Related Work

- [Personal Org Auto-Creation](_changelog/2026-03/2026-03-25-120817-personal-org-auto-creation.md)
- [Lazy Personal Org Backfill on Login](_changelog/2026-03/2026-03-25-122211-lazy-personal-org-backfill-on-login.md)
- [On-Behalf-Of gRPC Impersonation Infrastructure](_changelog/2026-03/2026-03-25-113851-on-behalf-of-grpc-impersonation-infrastructure.md)

---

**Status**: Production Ready
**Timeline**: Task 3 of auto-personal-org project (20260325.01)
