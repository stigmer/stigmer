# Monochrome Icon Rebrand and Theme-Aware Asset Pipeline

**Date**: April 1, 2026

## Summary

Replaced the old colored Stigmer logo with the new designer-provided monochrome icon (`Icon-bw.svg`) across the marketing site, docs, and web app. Built a theme-aware asset pipeline that serves the correct icon variant for dark and light modes, including auto-generated favicons with `prefers-color-scheme` media queries.

## Problem Statement

The existing Stigmer logo used a colored design that clashed with the site's black-and-white editorial theme. Additionally, sharing links on social media showed an OG image whose content didn't match the actual website copy.

### Pain Points

- Colored logo looked out of place on the monochrome marketing site
- "Stigmer" text next to the logo cluttered the header (designer spec shows icon-only)
- No light-mode icon variant — white-on-transparent SVG was invisible on light backgrounds
- Web app had no dark-mode favicon support
- OG image content was misaligned with the actual hero section copy
- Docs nav logo was invisible in dark mode due to Tailwind v4's `dark:` variant using `prefers-color-scheme` media queries instead of the `.dark` class that Fumadocs manages

## Solution

Three-pronged approach: replace all icon references with the new BW asset, build an automated image generation pipeline for both site and web app, and create a `currentColor`-based inline SVG component that adapts to any theme without relying on Tailwind's `dark:` variant.

## Implementation Details

### Icon Assets

- **`Icon-bw.svg`**: Designer-provided monochrome icon (white `#FEFEFE` paths on transparent background) for dark themes
- **`Icon-light.svg`**: Generated inverse variant (dark `#0a0a0a` paths) for light themes
- Both copied to `site/public/` and `client-apps/web/public/`

### Marketing Site (`site/`)

- **Header & Footer**: Replaced `logo.svg` + "Stigmer" text with standalone `Icon-bw.svg` at `w-8 h-8`
- **Logo component** (`logo.tsx`): Swapped the hardcoded "S" text mark for an `<img>` of `Icon-bw.svg`
- **Image generation** (`scripts/generate-images.ts`): Refactored to composite `Icon-bw.svg` onto a dark rounded-rect background for favicons/PWA icons, and render it directly on the gradient for the OG image
- **OG image**: Now uses the BW icon and matches the hero section's actual tagline

### Docs Navigation

- **Problem**: `hidden dark:block` / `block dark:hidden` CSS classes didn't work because Tailwind v4 defaults to `@media (prefers-color-scheme: dark)` for the `dark:` variant, while Fumadocs uses the `.dark` class via `next-themes`
- **Fix**: Created `StigmerIcon` component (`site/src/components/ui/stigmer-icon.tsx`) — an inline SVG using `fill="currentColor"` that automatically inherits the theme's text color. No dependency on Tailwind's dark variant at all.

### Web App (`client-apps/web/`)

- Added `prefers-color-scheme` media queries in `layout.tsx` metadata to serve `favicon-dark-*` / `favicon-light-*` based on system theme
- Created `scripts/generate-images.ts` to produce dark-mode favicons from `Icon-bw.svg`
- Added `sharp`, `png-to-ico`, and `tsx` as dev dependencies; integrated into `build` script

### stigmer-cloud

- Updated `docs/logo.svg` to embed the BW icon in a dark rounded-rect background for GitHub README display

## Benefits

- Consistent monochrome branding across all surfaces (site, docs, web app, OG image, GitHub)
- Theme-aware icons that adapt automatically — no manual toggling or broken variants
- Automated image generation eliminates manual Photoshop/Figma export steps
- `currentColor` approach is immune to CSS dark-mode configuration differences

## Impact

- **Users**: See the correct branded icon in browser tabs, bookmarks, and link previews regardless of OS theme
- **Site visitors**: Cleaner header with icon-only logo matching the designer's spec
- **Docs readers**: Logo now visible in both light and dark mode
- **Contributors**: OG image accurately represents the product when sharing links

## Related Work

- Follows the monochrome design direction established in the Phase 2 content strategy
- Builds on the image generation pipeline from the initial site setup

---

**Status**: ✅ Production Ready
