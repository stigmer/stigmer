# Invitation React SDK Components (Track 4B)

**Date**: April 6, 2026

## Summary

Added three self-contained, themed, embeddable React components to the invitation module in `@stigmer/react`: `InvitationManager` (admin panel for managing invite links), `InvitationRedemption` (invite acceptance flow), and `InvitationCreatedAlert` (post-creation copy-URL banner). All components compose the Track 4A hooks, follow established SDK patterns, and have zero Console dependencies.

## Problem Statement

Track 4A delivered five invitation hooks (`useOrgInvitations`, `useCreateInvitation`, `useRevokeInvitation`, `useInvitationPreview`, `useRedeemInvitation`), but platform builders still needed to write significant glue code to build a working invitation management UI or invite acceptance page. The SDK lacked the "drop-in" styled component layer for the invitation domain.

### Pain Points

- Platform builders had to manually compose five hooks, manage flow state machines (create → copy-URL → dismiss), and build revocation confirmation UX from scratch
- No standard invite acceptance component existed — every integrator would need to handle loading, invalid states, auth-required, redemption-in-flight, and success rendering independently
- The invitation domain was the only one with hooks but no corresponding styled components

## Solution

Three SDK components that provide the full invitation UX out of the box, following the `OrgMembersPanel` pattern (self-contained panels) rather than the API key pattern (separate pieces requiring Console-level composition).

## Implementation Details

### InvitationCreatedAlert (`InvitationCreatedAlert.tsx`, 186 lines)

- One-time banner following the `ApiKeyCreatedAlert` pattern
- Monospace URL field with clipboard copy + fallback text selection
- "Copied" feedback state with 2-second timeout
- Dismiss callback for parent flow control

### InvitationManager (`InvitationManager.tsx`, 842 lines)

- Self-contained panel composing `useOrgInvitations`, `useCreateInvitation`, `useRevokeInvitation`
- Internal flow state machine: idle → creating → created (alert + list refresh) → idle
- Create form: `RoleSelector` (defaults to viewer), label input, expiry picker (7/14/30 days), usage limit toggle (unlimited/single-use)
- Invitation list: label, role badge, state badge (active/expired/revoked/fully_redeemed), redemption count, relative expiry, copy-link button, revoke with inline confirmation
- `buildInviteUrl` prop for platform builders with custom URL schemes (defaults to `window.location.origin/invite/<token>`)
- Reuses existing `RoleSelector` from `iam-policy/` module

### InvitationRedemption (`InvitationRedemption.tsx`, 435 lines)

- Auth-agnostic via `isAuthenticated` + `onAuthRequired` props
- Fetches preview via `useInvitationPreview` (public endpoint)
- Org card: logo/initial avatar, org name, label, role badge, expiry
- Handles all states: loading skeleton, fetch error with retry, invalid invitation (reason notice), authenticated accept, unauthenticated sign-in CTA, redemption-in-flight, success, redemption error
- `onAccepted` callback for post-redemption navigation

### Design Decisions

- **D1: `buildInviteUrl` prop** over hardcoded URL — platform builders may have custom invite routes (`/join/` vs `/invite/`) or different domains
- **D2: `isAuthenticated` boolean** over embedded auth detection — keeps the component auth-agnostic, defaulting to `true` for the simplest integration path
- **D3: `org: string` (slug)** not `orgId` — mirrors the underlying SDK client parameter shape from the proto definitions

## Benefits

- Platform builders can embed invite management with `<InvitationManager org="acme" />` (one line)
- Invite acceptance works with `<InvitationRedemption token={t} onAccepted={fn} />` (one line)
- All components use `--stgm-*` design tokens — fully themeable via presets or custom overrides
- Consistent UX patterns: skeleton loading, inline error display, destructive confirmations, clipboard copy feedback

## Impact

- **Platform builders**: Can now offer invite link management and acceptance flows in their products without building custom UI
- **Console** (Track 5): Will consume these components with thin wrappers — `InvitationManager` in org settings, `InvitationRedemption` at `/invite/[token]`
- **SDK completeness**: The invitation domain now has the full three-layer stack: typed client → hooks → styled components

## Related Work

- Track 4A: Invitation React hooks (`2026-04-06-174755-invitation-react-hooks.md`)
- Track 1: Invitation proto layer (`2026-04-06-170812-invitation-resource-proto-layer.md`)
- Track 5 (next): Console integration — routing and settings wiring

---

**Status**: ✅ Production Ready
**Timeline**: Session 5, ~45 minutes
