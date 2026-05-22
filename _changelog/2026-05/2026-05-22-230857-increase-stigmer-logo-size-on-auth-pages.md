# Increase Stigmer Logo Size on Auth Pages

**Date**: May 22, 2026

## Summary

Increased the Stigmer brand mark from 40px to 56px on the invite and login pages, fixing its near-invisibility on full-screen dark backgrounds and restoring proper visual hierarchy relative to the org icon in the invitation card.

## Problem Statement

The `StigmerLogo` component rendered the brand mark at `size-10` (40x40px container with a 20x20px SVG). On the full-page dark background of the invite and login screens, this appeared as a barely-visible speck.

### Pain Points

- The platform brand mark was smaller than the org initial below it (`size-14` = 56px), inverting the visual hierarchy
- New users opening an invite link had no clear visual anchor establishing "this is Stigmer"
- The logo was disproportionate to the surrounding negative space on full-page auth layouts

## Solution

Increased the `StigmerLogo` container and SVG dimensions proportionally, and bumped the border radius to match the larger container.

## Implementation Details

Single file change in `client-apps/web/src/auth/StigmerLogo.tsx`:

- Container: `size-10` (40px) → `size-14` (56px)
- SVG: `width/height="20"` → `width/height="28"`
- Border radius: `rounded-lg` → `rounded-xl` (scales with larger container)
- Fill ratio preserved at ~50% (28/56 vs 20/40)

No new props or abstraction layers — both consumers (invite page, login page) share identical full-page layouts where the larger mark is appropriate.

## Benefits

- Brand mark is immediately visible on first page load
- Visual hierarchy restored: platform mark ≥ org icon
- Login page also benefits (same component)

## Impact

- **Invite page** — improved first impression for new invitees
- **Login page** — same improvement for returning users

---

**Status**: ✅ Production Ready
