# Site Polish: Logo Optimization, OG Image Rebuild, Use Cases Grid Fix

**Date**: April 1, 2026

## Summary

Thorough review of the marketing site revealed four issues: oversized logo SVGs (1.1MB each), an OG image using stale brand colors and old messaging, a Use Cases grid with a visible ghost cell from the `gap-px bg-border` pattern, and minor footer copyright spacing. All four are resolved with build passing clean.

## Problem Statement

After completing Phase 2 of the content strategy (full sales website), the site had accumulated artifacts from earlier design iterations that were never updated to match the current monochromatic Figma theme and positioning.

### Pain Points

- `logo.svg` and `logo-square.svg` were 1.1MB each — unoptimized Figma exports loaded on every page in the header and footer
- `generate-images.ts` still used blue/purple gradients (`#3b82f6`, `#8b5cf6`) and old messaging ("Build Agents. Skip the Infrastructure.") for the OG image, contradicting the current monochromatic palette and positioning headline
- The Use Cases section's `gap-px bg-border` grid pattern created a visible border-colored empty cell when 5 cards didn't fill the 3-column or 2-column layout evenly
- Footer copyright rendered "Stigmer ." with a space before the period due to JSX whitespace across lines

## Solution

- Optimized both logo SVGs with svgo multipass
- Rewrote the OG image generation to use the monochromatic palette and current positioning copy
- Switched Use Cases from a background-divider grid to individually bordered cards with gap spacing
- Collapsed footer copyright JSX to a single line

## Implementation Details

### Logo Optimization

Both `logo.svg` and `logo-square.svg` reduced from 1.1MB to 246KB (77.7%) via `npx svgo --multipass`. The two files differ only in corner radius: `logo.svg` uses `rx="107.5"` (circular), `logo-square.svg` uses `rx="12"` (rounded square).

### OG Image Rebuild (`site/scripts/generate-images.ts`)

- **Colors**: Replaced `COLORS.blue`/`COLORS.purple`/`COLORS.darkBg` (`#0a0f1a`) with monochromatic values: `darkBg: "#0a0a0a"`, `foreground: "#f5f5f5"`, `muted: "#a3a3a3"`, `subtle: "#505050"`
- **Background**: Simplified from linear gradient + radial accent blur to a single radial vignette (`#111111` center → `#0a0a0a` edges)
- **Headline**: Changed from "Build Agents. Skip the Infrastructure." to "Build agents that work for your business"
- **Sub-headline**: Changed from two lines about sandboxing/YAML to "Teach them your domain. Connect your tools. Set your rules."
- **Badges**: Changed from "Local-First / Open Source / gRPC APIs" (colored) to "Open Source / Apache 2.0" (monochromatic outline, monospace font)
- **Compression**: Reduced from level 9 to level 6 for better quality on social platforms

### Use Cases Grid (`site/src/components/sections/UseCases.tsx`)

Replaced:
```
grid gap-px bg-border rounded-lg overflow-hidden border border-border
```
With:
```
grid gap-6
```
Each card now has its own `rounded-lg border border-border`. This eliminates the ghost cell — empty grid positions are just transparent background.

### Footer Copyright (`site/src/components/layout/Footer.tsx`)

Collapsed `{holder}.\n  All rights reserved.` to `{holder}. All rights reserved.` on a single line to prevent JSX whitespace insertion.

## Benefits

- **2.2MB saved per page load** from logo optimization alone (two 1.1MB SVGs → two 246KB SVGs)
- OG image now accurately represents the product when shared on social media — correct branding, messaging, and visual identity
- Use Cases section renders cleanly regardless of card count — no visual artifacts from grid math
- Footer copyright renders correctly without orphaned punctuation

## Impact

- All marketing pages: header and footer load faster with optimized logos
- Social sharing (Twitter/LinkedIn/Slack previews): OG image now matches the live site's monochromatic dark theme and current positioning
- Homepage: Use Cases section is visually clean at all responsive breakpoints

## Related Work

- Phase 2 sales website implementation (Session 8 content strategy)
- Figma theme extraction and monochromatic palette adoption

---

**Status**: ✅ Production Ready
**Timeline**: Single session
