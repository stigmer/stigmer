# Add Discord Community Link to Site Header, Footer, and Mobile Menu

**Date**: April 3, 2026

## Summary

Added a Discord community link with a custom inline SVG icon to the stigmer.ai marketing site. The link appears in the desktop header (utility area between nav links and Sign In), the mobile menu drawer, and the footer bottom bar alongside the existing GitHub icon. The Discord invite URL is centralized in `SITE_CONFIG.social.discord`.

## Problem Statement

The stigmer.ai site had no Discord community link anywhere in its navigation. Users visiting the marketing site had no way to discover or join the Stigmer Discord community directly from the site chrome.

### Pain Points

- No community entry point in the site header or footer
- Users had to find the Discord link through external channels
- Missing parity with the planton.ai site which already surfaces Discord prominently

## Solution

Added Discord as a utility-tier link (same visual weight as Sign In) in three surfaces: desktop header, mobile menu, and footer. Created a reusable `DiscordIcon` inline SVG component using the same path data as the planton.ai Discord icon to maintain visual consistency across both sites.

## Implementation Details

- **`site/src/lib/constants.ts`** — Added `discord` URL to `SITE_CONFIG.social` as the single source of truth
- **`site/src/components/ui/discord-icon.tsx`** — New component: inline SVG with `currentColor` fill, `sm`/`md`/`lg` size variants, matching the Lucide icon API pattern used throughout the codebase
- **`site/src/components/layout/Header.tsx`** — Discord link with icon + label in the utility area before Sign In, styled as `text-muted-foreground` with `hover:text-foreground`
- **`site/src/components/layout/MobileMenu.tsx`** — Discord entry between NAV_LINKS and Sign In, with DiscordIcon inline and external-link indicator
- **`site/src/components/layout/Footer.tsx`** — Discord icon link next to the existing GitHub icon in the bottom bar

Design decision: Discord is not added to `NAV_LINKS` because it is a community/utility link, not a navigation destination. This matches the planton.ai pattern where Discord sits in the utility tier alongside Sign In, separate from Product/Solutions/Resources/Pricing.

## Benefits

- Users can discover and join the Discord community directly from any page
- Visual consistency with planton.ai branding (same Discord icon SVG)
- Single source of truth for the invite URL — changing it in `constants.ts` updates all three surfaces

## Impact

- **Marketing site visitors**: Can now join the Discord community with one click from any page
- **Mobile users**: Discord is accessible in the mobile menu drawer
- **Footer**: Community icons (Discord + GitHub) are grouped together for discoverability

---

**Status**: Production Ready
