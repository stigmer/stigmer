# SSO Login URL on IdP Detail Panel

**Date**: April 7, 2026

## Summary

Added a copyable SSO login URL field to the `IdentityProviderDetailPanel` SDK component, completing Phase 5 of the SSO login flow sub-project. When an identity provider is configured as an SSO provider, admins now see the org-specific login URL directly on the detail panel with one-click copy — giving them the exact URL to share with team members.

## Problem Statement

After enabling SSO for an organization (Phases 1–4), admins had no easy way to discover or share the SSO login URL (`/login?org=<slug>`). They would need to manually construct the URL from knowledge of the app's routing structure.

### Pain Points

- Admins had to remember the URL format and construct it by hand
- No discoverability: the SSO login entry point was invisible in the management UI
- Copy errors when sharing URLs verbally or via chat

## Solution

Added an optional `ssoLoginUrl` prop to `IdentityProviderDetailPanel`. When provided and the IdP is an SSO provider, the panel renders a read-only, copyable URL field in view mode. The Console computes the URL from `window.location.origin`; platform builders can pass their own URL or omit the prop entirely.

## Implementation Details

**SDK (`@stigmer/react`)** — `IdentityProviderDetailPanel.tsx`:
- New optional `ssoLoginUrl?: string` prop on `IdentityProviderDetailPanelProps`
- Prop threaded through to `ViewMode` internal component
- New `CopyableField` private helper (sibling to existing `Field` and `FieldInput` helpers):
  - Clipboard API with 2-second "Copied" feedback
  - Manual text selection fallback on clipboard failure (matching `InvitationCreatedAlert` pattern)
  - Screen reader announcement via `role="status" aria-live="polite"` region
  - Helper text: "Share this URL with your team members to sign in via SSO"
- Renders conditionally when `isSsoProvider && ssoLoginUrl` are both truthy
- View mode only — URL is derived from org slug, not editable

**Console (`client-apps/web`)** — `IdentityProvidersSection.tsx`:
- Computes `ssoLoginUrl` as `${window.location.origin}/login?org=${orgSlug}` when IdP is SSO-enabled
- Passes `undefined` for non-SSO providers (field hidden)

## Benefits

- **Zero-friction URL sharing**: admins copy the SSO login URL in one click
- **SDK-first architecture**: the field is part of the SDK component, available to platform builders who pass their own SSO entry point URL
- **Backward compatible**: optional prop, no barrel/export changes, no breaking changes
- **Accessible**: keyboard-navigable, screen reader announcements, clipboard failure fallback

## Impact

- Org admins configuring SSO can now immediately share the login URL with their team
- Platform builders embedding `IdentityProviderDetailPanel` can surface a custom SSO URL
- Completes Phase 5 of the SSO login flow sub-project (5 of 6 phases done)

## Related Work

- Phase 4: SSO Login Page (`2026-04-07-171753-sso-web-app-login-flow.md`)
- Phase 3: SSO Auto-Provisioning (`2026-04-07-165447-sso-auto-provisioning.md`)
- Phase 2: Backend Handlers (`2026-04-07-161730-sso-login-flow-backend-handlers.md`)
- Phase 1: Proto Changes (`2026-04-07-154352-sso-login-flow-proto-changes.md`)
- Parent project: `20260405.02.identity-provider-flow`

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~0.5 hours)
