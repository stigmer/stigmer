# Frontend BYOA (Bring Your Own App) Experience

**Date**: April 13, 2026

## Summary

Built the complete frontend BYOA experience for MCP server OAuth: a data+behavior hook for managing org-level OAuth app overrides, BYOA-aware derived state in the credentials hook, a two-field form component, and integration into both `McpServerDetailView` and `McpServerConfigPanel`. BYOA is available at all vendor approval states — primary when blocked (PENDING/REJECTED), secondary when approved.

## Problem Statement

After the backend BYOA infrastructure (T04–T05) and frontend gap fixes (T06), the final piece was missing: users had no way to register their own OAuth app credentials from the UI. Organizations that wanted to use their own OAuth apps — for privacy, rate limit isolation, compliance, or branding reasons — were blocked.

### Pain Points

- No UI surface to enter org-level OAuth app credentials (client_id + client_secret)
- No visibility into whether an org override was active vs. platform default
- BYOA was only conceived for when vendor approval was PENDING — but orgs need it regardless of approval status
- The frontend had no `VendorApprovalStatus.REJECTED` handling at all

## Solution

Implemented T07 (the final task in the OAuth BYOA integration project) as two new files and four file modifications across the `@stigmer/react` SDK package. BYOA is available for all vendor-OAuth MCP servers regardless of approval status, with prominence varying by context — Hick's Law (don't burden the common case with power-user decisions) while still respecting user control (Nielsen's heuristic #3).

## Implementation Details

### New: `useOrgOAuthApp` hook (250 lines)

Hybrid data+behavior hook following existing codebase conventions (`useOAuthGrantStatus` for data pattern, `useDisconnectOAuth` for behavior pattern):

- **Data side**: Auto-fetches `getOrgOAuthApp` when `resourceId + org` are non-null. Returns `hasOverride`, `oauthAppId`, `clientId`.
- **Behavior side**: `setOrgOAuthApp(clientId, clientSecret)` and `deleteOrgOAuthApp()` bound to the hook's resource+org context with separate loading/error state per mutation.
- Skips fetching when either arg is `null` (stable no-op with idle state).

### New: `OAuthAppForm` component (304 lines)

Pure presentational form — headless-first, no dialog wrapper. Platform builders who want a different dialog can import just the form.

- Two fields: client_id (text) and client_secret (password with show/hide toggle)
- Instruction text with provider name, optional vendor docs link
- Error display, submit/cancel actions
- All styling via `--stgm-*` tokens through `cn()`

### Enhanced: `useMcpServerCredentials`

Four new derived fields from `status.oauthStatus` (already enriched by backend, zero extra RPCs):

- `effectiveOAuthSource: OAuthAppSource` — which credential source is active
- `isOrgOAuthApp: boolean` — org override is active
- `canBringOwnApp: boolean` — BYOA is relevant (vendor OAuth with platform template, no override yet)
- `isVendorApprovalBlocked: boolean` — covers both PENDING and REJECTED (existing `isVendorApprovalPending` preserved for backward compat)

### Enhanced: `McpServerDetailView` ConnectBar

- **Vendor blocked + BYOA eligible**: "Use your own OAuth app" button inside the amber vendor-approval banner
- **Vendor approved + BYOA eligible**: "Use your own OAuth app" secondary link alongside "Enter token manually"
- **Org override active**: "Sign in with your app" button label, "Using your OAuth app" status indicator, "Remove custom app" link with inline confirmation
- Native `<dialog>` for BYOA form following `ArtifactPreviewModal` pattern
- Org override bypasses vendor gate — `oauthSignInDisabled` is `false` when `isOrgOAuthApp`

### Enhanced: `McpServerConfigPanel` InlineOAuthSignIn

Seven new optional BYOA props on `McpServerOAuthSignInProps` — fully backward compatible. `InlineOAuthSignIn` mirrors ConnectBar's behavior at compact density.

## Benefits

- Organizations can use their own OAuth apps regardless of platform vendor approval status
- Privacy-conscious teams get audit trail isolation and rate limit independence
- Enterprise compliance requirements for first-party OAuth app registration are supported
- The two-gesture save→sign-in flow avoids popup blocker issues
- All new components are headless-first — platform builders can import just the hooks or just the form

## Impact

- **SDK consumers**: `@stigmer/react` gains `useOrgOAuthApp`, `OAuthAppForm`, and 4 new fields on `useMcpServerCredentials` — all additive, no breaking changes
- **Platform builders**: Can embed BYOA into their own products by importing the hook + form
- **End users**: Can set up their own OAuth apps from the MCP server detail page or config panel
- **Project completion**: This is the final task (T07) in the OAuth BYOA integration project — all 10 identified gaps are now addressed

## Related Work

- [OAuth BYOA Proto Layer](2026-04-13-130208-oauth-byoa-proto-layer.md) — T01: proto definitions
- [Harden OAuth Refresh, Vendor Gate, Error UX](2026-04-13-131630-harden-oauth-refresh-vendor-gate-error-ux.md) — T03
- [OAuth Disconnect and Grant Health](2026-04-13-133813-implement-oauth-disconnect-and-grant-health.md) — T02
- [BYOA Infrastructure and Resolution Service](2026-04-13-153826-byoa-infrastructure-resolution-service.md) — T04
- [Go OSS OAuth Parity Fixes](2026-04-13-162138-go-oss-oauth-parity-fixes.md) — T02/T03 Go
- [Frontend Disconnect, Health, Error UX](2026-04-13-164036-frontend-disconnect-health-error-ux.md) — T06

---

**Status**: ✅ Production Ready
**Timeline**: T07 of 7-task OAuth BYOA integration project (single session)
