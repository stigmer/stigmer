# OrgGate: sign-out on onboarding and org-load error screens

**Date**: March 22, 2026

## Summary

Authenticated users hitting the organization gate (no orgs yet, or org list fetch failed) previously had no path to sign out because `UserMenu` lives inside `AppShell`, which renders only after `OrgGate` passes. A Console-only `GateHeader` on those gate screens restores user control and aligns with Nielsen’s “user control and freedom” heuristic.

## Problem Statement

After OIDC login, the “Welcome to Stigmer” flow renders outside the main app shell. Sign-out lived only in the sidebar user menu, so users could not leave the session or switch accounts from the org-creation screen.

### Pain Points

- No visible sign-out on the first-organization onboarding view
- Same gap on the org-list **ErrorState** (retry screen)
- Violates expected account affordances (top-right / escape path)

## Solution

Add a private `GateHeader` in `OrgGate.tsx` that uses existing `useAuth()` (`user`, `logout`). Render it only when `user` is non-null (OIDC). Position it top-right on `relative` full-screen wrappers for onboarding and error; keep loading spinner unchanged.

## Implementation Details

- **File**: `client-apps/web/src/components/auth/OrgGate.tsx`
- **Imports**: `useAuth` from `@/auth`, `LogOut` from `lucide-react`
- **UI**: Initial letter avatar (same idea as `UserMenu`), email, text “Sign out” + icon; theme tokens only (`bg-muted`, `text-muted-foreground`, `hover:text-foreground`)
- **Intentionally not in SDK**: Org gate and Console auth are application concerns; embedders supply their own auth and onboarding.

## Benefits

- Users can sign out or switch accounts before creating an org
- Consistent escape path on org-fetch failure
- No provider hierarchy or shell refactor; single-file, low-risk change

## Impact

- **Audience**: Stigmer Console users in OIDC mode on org gate screens
- **Not affected**: Disabled/local auth (`user` null — header hidden), main app shell after org exists

## Related Work

- Changelog: [org-onboarding-gate](2026-03-22-180026-org-onboarding-gate.md) (broader org gate context)
- Changelog: [web-oidc-auth-and-runtime-config](2026-03-22-165602-web-oidc-auth-and-runtime-config.md) (auth stack)

---

**Status**: Production ready  
**Timeline**: Single session
