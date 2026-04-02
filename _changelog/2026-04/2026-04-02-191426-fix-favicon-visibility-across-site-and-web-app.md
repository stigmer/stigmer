# Fix Favicon Visibility Across Docs Site and Web App

**Date**: April 2, 2026

## Summary

Replaced the programmatically-generated favicons with designer-provided SVGs (`stigmer_dark.svg` / `stigmer_light.svg`) as the source of truth, and added SVG favicons with tighter cropping so the Stigmer icon is clearly visible at browser-tab sizes. Both the docs site (`site/`) and the web console (`client-apps/web/`) now serve crisp, properly-sized favicons.

## Problem Statement

The Stigmer favicon was barely visible in browser tabs — users had to squint to recognize it.

### Pain Points

- The original `Icon-bw.svg` had no background, so the generation script composited it onto a dark rect with **12% padding** on each side
- The SVG itself had ~15% internal whitespace around the icon paths within its 34×34 viewBox
- Combined, only ~60% of the favicon area contained visible icon content
- At 16×16px the molecular pattern was about 9 pixels across — essentially invisible
- The web app (`client-apps/web/`) only generated dark-mode favicons; light-mode variants were referenced in metadata but never produced

## Solution

1. **Adopted designer-provided SVGs** — `stigmer_dark.svg` (dark bg `#0A0A0A`, white icon) and `stigmer_light.svg` (light bg `#F1F1F1`, dark icon) already include the rounded-rect background with proper colors and `rx="8"` corners
2. **Created tight-cropped favicon SVGs** — `viewBox="3 3 28 28"` instead of `"0 0 34 34"`, making the icon fill ~95% of the favicon area (up from ~78%)
3. **Added SVG favicons** — Modern browsers render these at native resolution, so the icon stays crisp on any display DPI
4. **Simplified generation scripts** — No more manual compositing; scripts render the designer SVGs at 1024px and downscale

## Implementation Details

### Docs site (`site/`)

| File | Change |
|------|--------|
| `public/favicon.svg` | New SVG favicon with tight `viewBox="3 3 28 28"` crop from designer's dark SVG |
| `scripts/generate-images.ts` | Uses tight favicon SVG for 16/32px PNGs, designer's original for apple-touch/PWA icons |
| `src/app/layout.tsx` | Added `favicon.svg` as preferred icon (`type: "image/svg+xml"`) |

### Web app (`client-apps/web/`)

| File | Change |
|------|--------|
| `public/favicon-dark.svg` | New tight-cropped dark SVG favicon |
| `public/favicon-light.svg` | New tight-cropped light SVG favicon |
| `scripts/generate-images.ts` | Rewritten: generates both dark and light PNG/ICO from designer SVGs |
| `src/app/layout.tsx` | Added SVG favicons with `media` queries for dark/light mode |

### Size comparison (32×32 favicon)

| Metric | Before | After |
|--------|--------|-------|
| Icon content width | ~25px (of 32) | ~30px (of 32) |
| Visible area utilization | ~60% | ~95% |
| Rounded corners | Generated (rx=184 at 1024, invisible at 32) | Removed for favicon; preserved on app icons |

## Benefits

- Favicon is immediately recognizable in the browser tab — no more squinting
- SVG favicons render at native resolution on Retina/HiDPI displays
- Web app now has proper light-mode favicons (were missing before)
- Generation scripts are simpler — no manual background compositing
- Designer's exact colors and proportions are preserved as source of truth

## Impact

- **Users**: Clear brand presence in browser tabs for both docs site and web app
- **Design consistency**: Favicon matches the designer's Figma assets exactly
- **Developer experience**: Simpler favicon pipeline; one designer SVG as single source of truth

## Related Work

- Designer-provided assets: `site/public/stigmer_dark.svg`, `site/public/stigmer_light.svg`
- Previous work: `a1b1ca4e` centralized demo styling tokens

---

**Status**: ✅ Production Ready
**Timeline**: ~1 hour
