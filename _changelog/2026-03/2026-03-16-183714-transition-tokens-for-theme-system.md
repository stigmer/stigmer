# Transition Tokens for Theme System

**Date**: March 16, 2026

## Summary

Added transition duration and timing function tokens (`--stgm-transition-duration`, `--stgm-transition-timing`) to the Stigmer theme system, with per-preset overrides that give each design language its own motion personality. Wired through Tailwind v4's `--default-transition-duration` / `--default-transition-timing-function` fallback mechanism so every existing `transition-colors`, `transition-all`, and `transition-transform` utility automatically resolves through the token chain with zero component changes.

## Problem Statement

The theme system had tokens for colors, typography, border radius, and shadows, but no tokens for motion. Every SDK and Console component using Tailwind's `transition-colors` / `transition-all` resolved to a hardcoded 150ms default regardless of which preset was active.

### Pain Points

- Presets could change how components look (colors, shadows, corners) but not how they feel (motion timing)
- Platform builders embedding Stigmer components had no way to align transition behavior with their host application's motion language
- The gap meant a "Corporate" preset and a "Startup" preset had identical interaction timing despite representing fundamentally different design philosophies
- No centralized control point for motion — each component baked in Tailwind defaults independently

## Solution

Two tokens (`--stgm-transition-duration`, `--stgm-transition-timing`) defined in `tokens.css` and overridden per preset, wired to Tailwind v4's internal fallback variables via `@theme inline`. The approach mirrors the shadow token pattern established in the previous task but with a key simplification: no dark mode variants needed, since motion is perceptually mode-agnostic.

## Implementation Details

### Token Definitions (`tokens.css`)

Added to `:root` only (after shadow tokens, before sidebar tokens):
- `--stgm-transition-duration: 150ms` — matches Tailwind v4 default for zero visual regression
- `--stgm-transition-timing: cubic-bezier(0.4, 0, 0.2, 1)` — matches Tailwind v4 default (Material Design standard curve)

No `.dark` overrides. A 200ms transition feels identical on light and dark backgrounds — there is no motion equivalent of shadow opacity needing compensation on dark surfaces.

### Tailwind v4 Wiring

Verified that Tailwind v4.2.1 uses CSS variable fallbacks in all transition utilities:
```css
transition-duration: var(--tw-duration, var(--default-transition-duration));
transition-timing-function: var(--tw-ease, var(--default-transition-timing-function));
```

Added to `@theme inline` in both SDK and Console stylesheets:
```css
--default-transition-duration: var(--stgm-transition-duration);
--default-transition-timing-function: var(--stgm-transition-timing);
```

Tailwind v4 inlines the reference at build time — the compiled CSS shows `var(--tw-duration, var(--stgm-transition-duration))` with no intermediate variable. Components using explicit `duration-200` still override via `--tw-duration`.

### Per-Preset Motion Character

Each preset overrides transition tokens in the light selector only (dark mode inherits):

- **Corporate** (200ms, `cubic-bezier(0.4, 0, 0.2, 1)`) — deliberate, enterprise-grade. Azure, Salesforce, ServiceNow use slightly longer transitions. Standard easing — enterprise values predictability.
- **Startup** (100ms, `cubic-bezier(0, 0, 0.2, 1)`) — instant, snappy. Linear, Vercel, Raycast minimize transition latency. Ease-out only — quick departure, gentle landing.
- **Friendly** (200ms, `cubic-bezier(0.4, 0, 0.2, 1)`) — relaxed, unhurried. Notion, Slack use approachable motion. Same duration as Corporate but paired with warmer colors and rounder corners for a distinct feel.
- **Fintech** (150ms, `cubic-bezier(0.25, 0.1, 0.25, 1)`) — precise, controlled. Stripe, Mercury use tight motion curves. Tighter cubic-bezier with less dramatic ease-in matches the "crisp" aesthetic.

## Benefits

- Every existing `transition-colors`/`transition-all`/`transition-transform` in SDK and Console components automatically resolves through the preset's motion tokens — zero code changes
- Platform builders can override `--stgm-transition-duration` and `--stgm-transition-timing` in their own CSS for full control
- Token system now covers the complete "effects" category: shadows + transitions
- Presets can now differentiate on motion feel, not just visual appearance
- Future `prefers-reduced-motion` support can be centralized with a single `@media` block in `tokens.css`

## Impact

- **SDK components**: All components using `transition-*` utilities now honor preset timing
- **Console**: Same wiring, same benefit
- **Platform builders**: Two new tokens available for custom theming
- **No breaking changes**: Base defaults replicate Tailwind v4 built-in values exactly

## Related Work

- Follows the shadow token pattern from [shadow-elevation-tokens-for-theme-system](2026-03-16-182033-shadow-elevation-tokens-for-theme-system.md)
- Part of the theme system gaps project (`20260316.04.theme-system-gaps`, Task 4 of 6)
- Next: Task 5 (z-index base token), Task 6 (SDK README documentation)

---

**Status**: Production Ready
**Timeline**: Single session (~30 minutes)
