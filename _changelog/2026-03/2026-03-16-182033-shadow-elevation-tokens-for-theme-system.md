# Shadow Elevation Tokens for Theme System

**Date**: March 16, 2026

## Summary

Added shadow elevation tokens (`--stgm-shadow-sm/md/lg`) to the Stigmer theme system, completing the token flow from base definitions through Tailwind v4 `@theme inline` mappings. Shadows are now fully customizable by presets and platform builders, using the same architecture established for colors, fonts, and border radius.

## Problem Statement

The Stigmer theme system tokenized colors, fonts, and border radius — but shadows were still hardcoded Tailwind defaults. This meant:

### Pain Points

- Presets (Corporate, Startup, Friendly, Fintech) could customize every visual aspect except shadows
- Platform builders embedding Stigmer components could not match shadow styles to their host application
- Dark mode shadows used the same opacity as light mode (10% black), making elevation cues nearly invisible on dark surfaces

## Solution

Followed the same token architecture already established for colors:

```
tokens.css (--stgm-shadow-*) → @theme inline (--shadow-*) → Tailwind utilities (shadow-sm/md/lg)
```

Three tiers — sm, md, lg — matching the exact shadow utilities used in the codebase (6 total consumers). Base values replicate Tailwind v4 defaults for zero visual regression.

## Implementation Details

### Base tokens (`sdk/theme/src/tokens.css`)

- Light mode: Tailwind v4 default shadow values (zero visual change)
- Dark mode: ~2.5x opacity increase (0.25-0.35 range) — standard practice from Material Design 3 and Apple HIG for perceptible elevation on dark surfaces

### Per-preset shadow character (4 preset CSS files)

Each preset overrides shadows in both light and dark mode to reinforce its design language:

- **Corporate** — Prominent shadows with higher opacity. Enterprise SaaS benefits from clear card elevation.
- **Startup** — Barely-there shadows with reduced blur and opacity (~40-60% of base). Matches the Linear/Vercel flat aesthetic.
- **Friendly** — Soft, diffused shadows with increased blur radius. Warm and approachable.
- **Fintech** — Tight, precise shadows with reduced blur. Stripe-like crispness.

### Tailwind v4 mapping (`@theme inline`)

Both `sdk/react/src/styles.css` (SDK) and `client-apps/web/src/app/globals.css` (Console) got three new entries:

```css
--shadow-sm: var(--stgm-shadow-sm);
--shadow-md: var(--stgm-shadow-md);
--shadow-lg: var(--stgm-shadow-lg);
```

This redirects Tailwind's `shadow-sm`/`shadow-md`/`shadow-lg` utilities through the token system. Existing components pick up the new values automatically — zero `.tsx` changes needed.

### Token grouping

Shadows are placed between chart tokens and sidebar tokens in all files, establishing the grouping: colors → effects → layout-specific.

## Benefits

- Presets can now express distinct shadow character matching their design language
- Platform builders can override `--stgm-shadow-sm/md/lg` to match their host application
- Dark mode shadows are visible for the first time (~2.5x opacity vs light mode)
- Zero visual regression on the default theme (base values match Tailwind defaults)
- Zero component changes required (Tailwind utilities resolve through tokens automatically)

## Impact

- **Files modified**: 7 (tokens.css, 4 preset CSS files, SDK styles.css, Console globals.css)
- **New files**: 0
- **Component changes**: 0
- **Visual regression**: None (default theme unchanged)
- **Scope**: SDK (`@stigmer/theme`, `@stigmer/react`) and Console (`client-apps/web`)

## Related Work

- [SDK Theme Token Sync](2026-03-16-173118-sdk-theme-token-sync-success-warning-info-chart.md) — Task 1: added color token mappings
- [StigmerProvider Preset Prop](2026-03-16-180112-stigmer-provider-preset-prop-and-dark-mode-css-fix.md) — Task 2: added preset prop and fixed dark mode selectors
- Part of project: `20260316.04.theme-system-gaps` (Task 3 of 6)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
