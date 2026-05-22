# Invitation Screen UX Redesign

**Date**: May 22, 2026

## Summary

Redesigned the invitation acceptance page (`/invite/{token}`) to deliver a professional first impression by adding Stigmer branding, improving role clarity with descriptions, and polishing the SDK component's visual hierarchy. The page now matches the login page's branded layout pattern.

## Problem Statement

The invitation page is often the first thing a new user sees of Stigmer. The existing page rendered a minimal card on an empty page with zero brand context, ambiguous label display, and no explanation of what the granted role actually means.

### Pain Points

- No Stigmer logo or branding — a blank page with a floating card
- Inconsistent with the login page, which already has the correct branded public page pattern
- The `label` field ("Swarup") displayed without qualifying context, easily mistaken for an inviter name
- "Owner access" shown in tiny muted text with no explanation of what the role grants
- The page wrapper had no `bg-background` class, causing theme compliance issues in dark mode
- CTA button had thinner padding than the login page's buttons

## Solution

Two-layer approach respecting the SDK/Console architecture boundary (DD-001 through DD-005):

1. **Console layer** — Added Stigmer branding above the invitation card, matching the login page's layout hierarchy (logo + "You're invited" heading)
2. **SDK component** — Polished `InvitationRedemption` with larger org avatar, card elevation, role badge with description, italic label, and increased button padding

## Implementation Details

### Phase 1: Console Page Branding (client-apps/web)

- Extracted `StigmerLogo` from `LoginPageView.tsx` into `client-apps/web/src/auth/StigmerLogo.tsx` — shared by login and invite pages, Console-only (not SDK per "platform for platforms" principle)
- Updated `InvitePageClient.tsx` with branded layout: `StigmerLogo` + "You're invited" heading + `bg-background` for theme compliance + `flex-col` + `max-w-sm space-y-8` wrapper matching login page structure

### Phase 2: SDK Component Polish (sdk/react)

- Org avatar increased from 48px to 56px (`size-12` → `size-14`) for stronger visual anchor
- Card elevation via `shadow-sm` on main card, error card, success card, and loading skeleton
- Role display upgraded to a bordered badge with `iamRoleDescription()` underneath (e.g., "Full access including delete and access management" for Owner)
- Label rendered in italic to signal it's a descriptive note, not an identity
- CTA button padding increased from `py-2` to `py-2.5`, matching login page buttons
- Loading skeleton updated to match new card dimensions
- Removed unused `Separator` component

## Benefits

- First impression now includes Stigmer branding and clear context
- Users see what their granted role means before accepting (critical for high-privilege grants like Owner)
- Visual consistency between login and invite — the two public pages now share the same layout pattern
- All changes use existing `--stgm-*` tokens; no new tokens needed, no hardcoded colors
- Zero props API changes — fully backward-compatible for platform builders

## Impact

- **End users**: Better first impression, clearer security context when accepting invitations
- **Platform builders**: No impact — `InvitationRedemptionProps` API unchanged, visual improvements flow through tokens
- **Desktop app**: No impact — DD-016 not triggered (desktop has no invite redemption route)
- **Future work**: Phase 3 (inviter identity via proto enhancement) deferred to separate PR

## Related Work

- Original invitation flow: `_projects/2026-04/20260406.01.org-invitation-flow/`
- Previous invite page fixes: `2026-05-22-201305-fix-invite-link-public-route.md`, `2026-05-19-210416-fix-invite-page-blank-screen.md`
- SDK architecture standards: `_projects/2026-04/20260423.01.web-sdk-architecture-standards/`

---

**Status**: ✅ Production Ready
