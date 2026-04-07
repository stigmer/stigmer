# SSO Web App Login Flow (Phase 4)

**Date**: April 7, 2026

## Summary

Implemented the user-facing SSO login flow in the Stigmer web app: a `/login` page with org discovery, OIDC redirect to the organization's SSO identity provider, callback handling with sessionStorage-based routing, and an SDK-first `SsoLoginPrompt` component. This is the critical user-facing piece that connects the backend SSO auto-provisioning (Phase 3) to actual browser-based authentication.

## Problem Statement

With Phases 1-3 complete (proto definitions, backend lifecycle handlers, and SSO auto-provisioning), there was no way for end users to actually authenticate via SSO in the web app. The existing auth flow only supported Auth0 — unauthenticated users were immediately redirected to Auth0's hosted login page with no option for org-specific SSO.

### Pain Points

- SSO users had no entry point — the app auto-redirected to Auth0 on every visit
- Org admins had no URL to share with team members for SSO sign-in
- The `getSsoProvider` unauthenticated RPC (built in Phase 1) had no consumer in the web layer
- Platform builders had no SDK component for SSO discovery in their own apps

## Solution

A two-layer implementation following the SDK-first principle:

1. **SDK layer** (`@stigmer/react`): A reusable `SsoLoginPrompt` component that handles org discovery and SSO provider lookup. Platform builders embed this in their own login pages.
2. **Console layer** (`client-apps/web`): A `/login` route that composes the SDK component with Auth0 fallback and OIDC redirect mechanics via `oidc-client-ts`.

The existing `OidcAuthProvider` was extended to handle SSO callbacks alongside Auth0 callbacks using sessionStorage-based routing — no new callback routes needed.

## Implementation Details

### SSO Session Management (`sso-session.ts`)

Two sessionStorage keys manage the SSO lifecycle:
- `stigmer:sso:login` — ephemeral state written before the SSO redirect, consumed during callback processing
- `stigmer:sso:session` — persistent state written after successful callback, used for session restore on page reloads

### SsoLoginPrompt SDK Component

A 5-phase state machine (`input` → `loading` → `found`/`not-found`/`error`) that uses `useSsoProvider` internally. Props: `initialOrg` (pre-fill from URL), `onSsoLogin` callback (consumer handles OIDC redirect), `className`. Themed via `--stgm-*` tokens, accessible with ARIA labels.

### Provider Tree Bifurcation

The login page runs pre-authentication. Rather than bypassing `AuthGuard` (which would still expose `OrgProvider` and `StigmerTransportBridge` with their unauthenticated failure modes), the `/login` route gets an entirely separate provider tree: only `ConfigGate` + `ThemeProvider`. The page creates its own unauthenticated `StigmerProvider` with `getAccessToken: () => null`.

### OidcAuthProvider SSO Support

Three modifications:
- **`resolveActiveManager()`**: checks for SSO session in sessionStorage and creates the appropriate `UserManager` (SSO or Auth0) on mount
- **`processSsoOrAuth0Callback()`**: detects SSO login state, creates SSO `UserManager` for code exchange, persists session config
- **SSO logout**: clears session storage, calls `removeUser()`, redirects to `/login?org=...` (local-only, no RP-initiated logout)

## Benefits

- **End-to-end SSO flow**: users can now authenticate via their organization's identity provider (Okta, Azure AD, Auth0-as-SSO, etc.) through a clean login page
- **Shareable SSO URL**: org admins share `app.stigmer.ai/login?org=acme` with team members
- **SDK-first**: `SsoLoginPrompt` is immediately available to platform builders who want SSO login in their own apps
- **Zero regression**: Auth0 flow is completely unchanged; SSO is an additive path
- **Clean session lifecycle**: SSO sessions persist across page reloads via the same `oidc-client-ts` UserManager pattern

## Impact

- **End users**: SSO users can now authenticate without Auth0, using their organization's identity provider
- **Org admins**: have a concrete URL to share for SSO onboarding
- **Platform builders**: can embed `SsoLoginPrompt` from `@stigmer/react` for SSO discovery in their own apps
- **Codebase**: no breaking changes; provider bifurcation pattern is reusable for future public pages

## Related Work

- Phase 1: Proto changes — `expected_audience` on `SsoProviderInfo`, lifecycle RPCs
- Phase 2: Backend handlers — `UpdateFederatedAccountHandler`, `DeprovisionFederatedAccountHandler`
- Phase 3: SSO auto-provisioning — `SsoAutoProvisioner`, viewer role grant on first login
- Phase 5 (next): SSO Login URL on IdP Detail Panel
- Phase 6 (next): Documentation updates

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
