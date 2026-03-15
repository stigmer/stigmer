# Web Console Visual Identity & Theme System

**Date**: March 15, 2026

## Summary

Replaced the Stigmer web console's default monochrome shadcn palette with a teal brand color system, activated dark mode with `next-themes`, added semantic status tokens (`success`, `warning`, `info`), and audited typography for consistency. The console now has a distinctive visual identity and fully functional theme switching.

## Problem Statement

The Stigmer web console had zero brand identity — every design token in `tokens.css` used OKLCH chroma `0` and hue `0`, producing a grayscale palette indistinguishable from an unskinned shadcn template. Dark mode tokens existed in the CSS but had no activation mechanism: no toggle, no system preference detection, no `next-themes`. For a platform-for-platforms product, this was a credibility gap.

### Pain Points

- No brand differentiation — the console looked like every other shadcn starter
- Dark mode defined but completely inaccessible to users
- No semantic status colors beyond `--destructive` (red) — execution monitoring, health indicators, and system state badges had no token vocabulary
- Inconsistent monospace usage for technical identifiers (slugs, IDs)

## Solution

Single brand accent (teal, OKLCH hue 190) against a neutral canvas, semantic status tokens for the execution monitoring domain, and `next-themes` for class-based dark mode with system preference detection.

## Implementation Details

### Brand Color System

Replaced monochrome `--primary` with teal across both `:root` and `.dark`:

- Light mode: `oklch(0.55 0.12 190)` — medium-depth teal with strong contrast on white
- Dark mode: `oklch(0.72 0.12 190)` — lighter teal visible on dark backgrounds
- `--ring` and `--sidebar-ring` tinted to match brand hue
- `--sidebar-primary` unified with `--primary` for consistent brand expression

Neutral structural tokens (`--accent`, `--muted`, `--secondary`) intentionally left as gray — brand identity flows through `--primary` alone.

### Semantic Status Tokens

Added three new token pairs to both light and dark palettes:

| Token | Light | Dark | Use Case |
|-------|-------|------|----------|
| `--success` | `oklch(0.55 0.15 150)` | `oklch(0.70 0.15 150)` | Agent completed, healthy |
| `--warning` | `oklch(0.75 0.18 80)` | `oklch(0.78 0.16 80)` | Pending approval, degraded |
| `--info` | `oklch(0.55 0.15 250)` | `oklch(0.70 0.15 250)` | In-progress, informational |

Mapped through `globals.css` into Tailwind's `@theme inline` block so they're available as `bg-success`, `text-warning`, etc.

### Dark Mode Activation

- Installed `next-themes` — class-based dark mode with SSR flash prevention
- `ThemeProvider` wraps the entire provider tree as the outermost provider (no auth/org dependencies)
- Three-way toggle (Light / System / Dark) placed in sidebar footer
- Uses `resolvedTheme` from `next-themes` for hydration safety (avoids `useState`/`useEffect` mount pattern that triggered ESLint `set-state-in-effect` rule)
- `suppressHydrationWarning` on `<html>` for `next-themes` inline script compatibility

### Typography Audit

- Heading hierarchy verified as consistent: `text-lg font-semibold` (h1), `text-xl font-semibold` (h2 detail), `text-sm font-semibold tracking-wider uppercase` (h3 sections)
- Fixed 3 missing `font-mono` instances on qualified slugs in `AgentPicker.tsx` and `DraftPage.tsx`

### Architecture Decision

`next-themes` is Console-specific — it stays in `src/components/auth/Providers.tsx`, not in `@stigmer/theme`. The theme package remains framework-agnostic (CSS custom properties + `cn()` utility), preserving the platform-for-platforms mandate: embeddable components consume CSS variables and are inherently theme-able by the host application.

## Benefits

- **Brand identity**: The console is immediately recognizable as Stigmer — teal accent against neutral canvas
- **Dark mode**: Developers (the primary audience) get the dark mode they expect from DevTools (Jakob's Law)
- **Status vocabulary**: Future execution monitoring views have semantic tokens ready to use
- **Tunable**: Brand color is a single OKLCH hue — changing it is a one-line edit per token
- **No technical debt**: Clean implementation using established library (`next-themes`), no custom state management

## Impact

- **Files changed**: 9 modified, 1 new (`ThemeToggle.tsx`)
- **Dependencies added**: `next-themes`
- **Breaking changes**: None — all existing components adopt the new primary color automatically through CSS variables
- **Verification**: `npm run build`, `npm run lint`, `npm run format:check` all pass clean

## Related Work

- [Web Phase 1: Dead Code & Tooling](2026-03-15-150158-web-phase1-dead-code-tooling.md)
- [Web Phase 2: Package Rename](2026-03-15-152109-web-phase2-package-rename.md)
- Next: Phase 3 (T05: Navigation IA Design Decision)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
