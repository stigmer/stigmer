# Invite Page: Brand Logo and Auth UX Fix

**Date**: May 22, 2026

## Summary

Fixed two issues on the public invitation page: replaced the incorrect placeholder logo with the actual Stigmer brand mark, and redesigned the auth UX to eliminate the confusing "Sign in to accept" / "Accept Invitation" distinction. The button now always reads "Accept Invitation" regardless of auth state, with auto-redemption after the OIDC redirect.

## Problem Statement

The invite page at `/invite/[token]` had two user-facing issues:

### Pain Points

- The Stigmer logo rendered a generic stacked-layers SVG icon instead of the actual brand mark, misrepresenting the product identity on first impression
- Users who were logged in on another browser tab still saw "Sign in to accept" because the OIDC session uses `sessionStorage` (tab-scoped). Silent cross-tab detection via iframe is unreliable with the current `stigmer-prod.us.auth0.com` domain due to third-party cookie blocking across Safari, Firefox, and Chrome
- After clicking "Sign in to accept" and completing the Auth0 redirect, users returned to the invite page and had to click "Accept Invitation" a second time

## Solution

**Logo fix**: Replaced the 3-path stroke-based placeholder in `StigmerLogo.tsx` with the actual 8-path Stigmer brand mark from `Icon-light.svg`. Uses `fill="currentColor"` with `text-primary-foreground` so the mark adapts to light/dark themes automatically. This also fixes the login page, which uses the same component.

**Auth UX redesign**: Unified the CTA to always show "Accept Invitation" and added an auto-accept mechanism that eliminates the second click after an OIDC redirect.

## Implementation Details

### Brand Logo (`StigmerLogo.tsx`)
- Replaced `viewBox="0 0 24 24"` with `viewBox="0 0 34 34"` to match the brand mark's coordinate space
- Switched from `stroke="currentColor"` to `fill="currentColor"` since the brand mark uses fills, not strokes
- Embedded all 8 SVG paths from the canonical `Icon-light.svg` asset

### Unified CTA (`InvitationRedemption.tsx`)
- Changed the unauthenticated button text from "Sign in to accept" to "Accept Invitation"
- Added `autoAccept` prop that triggers automatic redemption when `true` and user is authenticated
- Auto-accept is guarded by a ref to prevent double-firing across React re-renders
- Updated all JSDoc to reflect that `isAuthenticated` controls button action (not text)

### Auto-Redemption Flow (`InvitePageClient.tsx`)
- Added `stigmer:invite:auto_accept` sessionStorage flag, set before the OIDC redirect
- Extended `useInviteAuth` to consume and clear the flag on return, exposing `autoAccept` in the hook's return value
- Passes `autoAccept` through to `InvitationRedemption`, which auto-triggers the redeem RPC

### End-to-End Flow
1. User opens invite link → sees "Accept Invitation" button
2. Clicks "Accept Invitation" → auto-accept flag saved → redirected to Auth0
3. If already logged in at Auth0: sub-second redirect back → auto-redeem → "You've joined [org]"
4. If not logged in: Auth0 login form → redirect back → auto-redeem → "You've joined [org]"

## Benefits

- Correct brand identity on the first public-facing touchpoint
- No confusing "Sign in to accept" text for users who are already logged in elsewhere
- One-click acceptance flow (instead of click → redirect → click)
- Clean SDK API: `autoAccept` prop is opt-in and documented for platform builders

## Impact

- **Invite page** — immediate UX improvement for all new invitees
- **Login page** — also gets the correct logo (shares `StigmerLogo` component)
- **SDK** — `InvitationRedemption` gains a new `autoAccept` prop (backward-compatible, defaults to `false`)

## Related Work

- `2026-05-22-210403-invitation-screen-ux-redesign.md` — prior invitation screen work
- `2026-05-22-201305-fix-invite-link-public-route.md` — fixed the public route for invite links
- Future: Auth0 Custom Domain setup (`auth.stigmer.ai`) would enable true cross-tab silent auth

---

**Status**: ✅ Production Ready
