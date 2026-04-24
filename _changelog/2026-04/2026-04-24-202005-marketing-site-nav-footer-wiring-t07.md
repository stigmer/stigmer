# Marketing Site Nav/Footer Wiring (T07)

**Date**: April 24, 2026

## Summary

Wired the `/download` page into the marketing site header navigation and footer. The download page shipped in T06 but was only reachable via direct URL or doc links — now it is discoverable from every page on the site through the global nav and footer.

## Problem Statement

The `/download` page for Stigmer Desktop existed but had no entry points in the site chrome. A visitor browsing the marketing site had no way to discover the download page without already knowing the URL or following a link from the documentation.

### Pain Points

- `/download` unreachable from site navigation
- Footer Product section had no path to the desktop app
- Mobile menu also lacked a download entry (reads from the same `NAV_LINKS` array)

## Solution

Added entries to the data-driven `NAV_LINKS` and `FOOTER_LINKS` arrays in `site/src/lib/constants.ts`. Because Header, MobileMenu, and Footer all iterate these arrays, a single-file change wired all three surfaces.

## Implementation Details

**Single file changed**: `site/src/lib/constants.ts`

- **`NAV_LINKS`**: Added `{ label: "Download", href: "/download" }` between Pricing and GitHub. Positioning follows the decision funnel: learn (Use Cases, Docs, Blog) → evaluate (Pricing) → get (Download) → source (GitHub).
- **`FOOTER_LINKS.product`**: Appended `{ label: "Download", href: "/download" }` after Documentation.
- **IA comment**: Updated the stale `Per IA Section 2: ...` comment above `NAV_LINKS` to reflect the actual current nav layout (including Blog, Download, and Discord which were added after the original IA spec).

No component files touched — the data-driven pattern means Header.tsx, MobileMenu.tsx, and Footer.tsx required zero changes.

## Benefits

- Download page discoverable from every page on the site
- Mobile visitors also see the Download link (MobileMenu reads `NAV_LINKS`)
- Footer provides a secondary discovery path for users who scroll to the bottom
- Zero component complexity added — pure data change

## Impact

- **Marketing site visitors**: Can now navigate to `/download` from the header nav or footer on any page
- **Mobile visitors**: Download link appears in the slide-out mobile menu
- **Maintainers**: IA comment in constants.ts now accurately reflects the live nav, reducing confusion for future contributors

## Related Work

- **T06** (`6e879ead7`): Created the `/download` page with platform detection and download buttons
- **T08** (next): Console "Get Desktop App" in user menu
- **T09** (next): Console contextual runner promotion

---

**Status**: ✅ Production Ready
