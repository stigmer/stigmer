# Organization Onboarding Gate for First-Time Users

**Date**: March 22, 2026

## Summary

Added an organization gate (`OrgGate`) to the web Console provider hierarchy that blocks the application shell until the authenticated user has at least one organization. First-time users who sign up via Auth0 now see a focused onboarding screen with an inline organization creation form instead of a broken, context-less Console.

## Problem Statement

When a new user signed up and logged in for the first time, the Auth0 webhook created an `IdentityAccount` but no organization. The Console rendered the full app shell — sidebar, session launcher, library — with no org context. All session and resource operations silently failed because they require an organization scope.

### Pain Points

- `OrgProvider` returned an empty list, setting `activeOrg` to `null` and `useActiveOrgSlug()` to `""`
- `SessionLauncher.handleSubmit()` passed `org: ""` to the backend, causing silent failures
- `useSessionList()` returned nothing (no org membership means no sessions)
- The only way to create an organization was buried in the `OrgSwitcher` dropdown — a discoverability failure for new users
- No visual indication of what the user should do; the Console appeared broken

## Solution

Inserted an `OrgGate` component into the provider hierarchy between `OrgProvider` and `AppShell`. The gate intercepts three pre-app states:

1. **Loading** — full-screen spinner while `findMyOrganizations()` is in flight
2. **Error** — centered error message with a retry button
3. **No organizations** — focused onboarding screen with the `CreateOrganizationForm` from `@stigmer/react`

Once the user creates their first organization, `OrgProvider.refresh(newSlug)` re-fetches the list, auto-selects the new org, and the gate passes through to the normal app.

## Implementation Details

### New file: `client-apps/web/src/components/auth/OrgGate.tsx`

- Console-only component (not in `@stigmer/react`) — platform builders handle their own org provisioning
- Reuses `CreateOrganizationForm` from `@stigmer/react` (SDK component)
- Uses main-area theme tokens (`bg-background`, `text-foreground`, `text-muted-foreground`, `bg-muted`, `hover:bg-primary-hover`) — compliant with `--stgm-*` token system
- Three sub-components: `LoadingState`, `ErrorState`, `OnboardingState` — clean separation of concerns

### Updated: `client-apps/web/src/components/auth/Providers.tsx`

- Added `OrgGate` to the provider nesting order between `OrgProvider` and `{children}`
- Updated the provider hierarchy documentation comment

### Updated: `client-apps/web/src/components/session/SessionLauncher.tsx`

- Added defensive guard in `handleSubmit`: if `org` is empty, shows a toast error and returns early instead of making API calls with empty org context

## Benefits

- First-time users have a clear, focused path to get started
- The Console never renders in a broken state without org context
- Defense-in-depth: even if `OrgGate` were bypassed, `SessionLauncher` guards against empty org submissions
- Pattern follows established SaaS onboarding conventions (GitHub, Vercel, Linear)

## Impact

- **First-time cloud users**: No longer see a broken Console after signup; guided through org creation
- **Existing users**: No change — `OrgGate` passes through immediately when orgs exist
- **SDK packages**: No changes — `CreateOrganizationForm` reused as-is

## Related Work

- `OrgProvider` (`client-apps/web/src/contexts/org-context.tsx`) — already handled empty state correctly; no changes needed
- `OrgSwitcher` — retains its role for subsequent org creation/switching after initial onboarding
- Auth0 webhook workflow — creates `IdentityAccount` only; org creation remains explicit and user-controlled

---

**Status**: Production Ready
