# Fix Invite Link — Make Route Public and Self-Contained

**Date**: May 22, 2026

## Summary

Fixed invite links (`/invite/<token>`) by adding the route to `PUBLIC_ROUTES` and rewriting the invite page as a self-contained component with its own `StigmerProvider`. Previously, unauthenticated users were immediately redirected to Auth0 login and never saw the invite preview.

## Problem Statement

Visiting `https://app.stigmer.ai/invite/<token>` showed "Invitation not found" because the `/invite/` route was forced through the full authenticated provider chain (`AuthGuard` → `IdentityAccountGate` → `OrgGate`). The backend `getByToken` RPC is correctly marked `is_public` and works fine — the issue was purely frontend routing.

### Pain Points

- Unauthenticated users clicking an invite link were immediately redirected to Auth0 login, never seeing the invite preview
- First-time users (no identity account, no org) could fail in the `IdentityAccountGate` or `OrgGate` even after logging in
- The `InvitationRedemption` SDK component already supports unauthenticated preview via its `isAuthenticated` / `onAuthRequired` props, but `AuthGuard` blocked it from ever rendering

## Solution

Followed the same pattern as the `/login` page: made `/invite/` a public route and gave it its own `StigmerProvider` with standalone OIDC session detection.

## Implementation Details

**`Providers.tsx`** — Added `/invite/` to `PUBLIC_ROUTES` so the invite page bypasses the entire authenticated provider chain.

**`InvitePageClient.tsx`** — Rewrote as a self-contained public page:

- Creates its own `Stigmer` client (unauthenticated by default, authenticated after OIDC return)
- Wraps content with `StigmerProvider` (same pattern as `LoginPageView`)
- `useInviteAuth()` hook detects OIDC sessions in sessionStorage via `UserManager.getUser()`, handling both Auth0 and SSO sessions
- `handleAuthRequired` saves the current invite path to sessionStorage and triggers OIDC redirect directly (reusing `createUserManager` and `resolveAuthConfig`)
- Disabled-auth mode (OSS) treats the user as always authenticated

**No changes to**: `AppShell` (already detects `/invite/` as public zone), `OrgGate` (already bypasses for `/invite/`), React SDK, or the backend.

## Benefits

- Invite links work for unauthenticated users — they see the org name, role, and invite validity before signing in
- First-time users can accept invitations without hitting `IdentityAccountGate` or `OrgGate` failures
- Self-contained architecture keeps the invite page isolated from the auth provider chain, matching the login page pattern

## Impact

- **Users**: Anyone receiving an invitation link can now preview and accept it
- **Ops**: Requires a rebuild and redeploy of the web app container

---

**Status**: ✅ Production Ready
