# Fix Base Theme Surface Hierarchy

**Date**: March 17, 2026

## Summary

Fixed the base design tokens in `@stigmer/theme` to establish a proper surface elevation hierarchy in both light and dark mode. The base theme — which is the default for every platform builder who does not apply a preset — had zero visual distinction between cards and background in light mode, making borders, input fields, and surface boundaries invisible.

## Problem Statement

The Stigmer Console and all SDK embeddable components rendered with broken visual hierarchy in light mode when using the base (no-preset) theme tokens.

### Pain Points

- `--stgm-card` and `--stgm-background` were identical (`oklch(1 0 0)`) — pure white on pure white. Cards had zero figure-ground distinction from the page.
- `--stgm-border` at `oklch(0.922 0 0)` produced a contrast difference of only ~0.078 against the white surfaces — barely perceptible as a 1px line.
- `--stgm-muted` at `oklch(0.97 0 0)` was nearly indistinguishable from the background — inactive tabs, badges, and subdued elements were functionally invisible.
- `--stgm-input` was the same as `--stgm-border`, so input fields inside cards had no visual boundary.
- Dark mode was better (card 0.205 vs background 0.145), but borders at 10% white opacity were still too faint.
- Three places in the Console layout bypassed the sidebar-border token with hardcoded `foreground/10` opacity classes.

## Solution

Adjusted 15 token values in `sdk/theme/src/tokens.css` to create a clear surface elevation ladder. No component code changes needed — every component already referenced the correct token classes (`bg-card`, `border-border`, `bg-muted`, `border-input`). The values they resolved to were the problem.

Additionally replaced three token bypasses in Console layout components with proper `sidebar-border` token references.

## Implementation Details

### Light Mode (`:root`) — 12 token adjustments

**Surface hierarchy established:**
- `--stgm-background`: `oklch(1 0 0)` → `oklch(0.98 0 0)` — off-white page canvas
- `--stgm-card`: kept at `oklch(1 0 0)` — white cards float above background (+0.02 elevation gap)
- `--stgm-sidebar`: `oklch(0.985 0 0)` → `oklch(0.97 0 0)` — sidebar reads as a distinct, slightly recessed rail

**Boundaries strengthened:**
- `--stgm-border`: `oklch(0.922 0 0)` → `oklch(0.885 0 0)` — visible 1px lines
- `--stgm-input`: `oklch(0.922 0 0)` → `oklch(0.87 0 0)` — input fields clearly bounded inside cards
- `--stgm-sidebar-border`: aligned with border at `oklch(0.885 0 0)`

**Passive surfaces differentiated:**
- `--stgm-muted`, `--stgm-secondary`, `--stgm-accent`, `--stgm-sidebar-accent`: all moved from `oklch(0.97 0 0)` → `oklch(0.94 0 0)`

Resulting surface ladder:

```
popover/card (1.0) > background (0.98) > sidebar (0.97) > muted (0.94) > border (0.885) > input (0.87)
```

### Dark Mode (`.dark`) — 3 token adjustments

- `--stgm-border`: `oklch(1 0 0 / 10%)` → `oklch(1 0 0 / 14%)` — borders reliably visible
- `--stgm-input`: `oklch(1 0 0 / 15%)` → `oklch(1 0 0 / 20%)` — input boundaries clear
- `--stgm-sidebar-border`: aligned with border at `oklch(1 0 0 / 14%)`

### Token Bypass Cleanup — 3 file edits

- `AppShell.tsx`: `border-foreground/10` → `border-sidebar-border`
- `Sidebar.tsx` (separator): `bg-foreground/10` → `bg-sidebar-border`
- `Sidebar.tsx` (user menu border): `border-foreground/10` → `border-sidebar-border`

## Benefits

- **Light mode is functional**: Cards, borders, inputs, and muted elements are all visually distinct — the UI is usable without squinting.
- **SDK default is production-ready**: Platform builders who embed Stigmer components without choosing a preset now get a properly structured theme out of the box.
- **Preset themes unaffected**: Corporate, startup, friendly, and fintech presets override the base tokens independently and were already correct.
- **Token discipline enforced**: The three `foreground/10` bypasses now participate in the token system, so preset overrides apply correctly to sidebar borders.
- **WCAG compliance maintained**: The background shift from 1.0 to 0.98 is negligible against foreground at 0.145 — text contrast remains well above AAA.

## Impact

- **`@stigmer/theme`**: Base token values changed — affects every consumer that uses the default (no-preset) theme.
- **Console layout**: Three sidebar border classes updated to use proper tokens.
- **Platform builders**: Any integrator using the base theme gets improved surface hierarchy automatically on next build.
- **No breaking changes**: Token variable names are unchanged. Only values changed. All downstream consumers resolve new values without code changes.

## Related Work

- Preset themes (corporate, startup, friendly, fintech) already had proper surface hierarchy — they served as reference for the base token values.
- The `border-foreground/10` convention was established in the T01.4 app shell checkpoint; this cleanup replaces it with proper token usage.

---

**Status**: ✅ Production Ready
**Files Changed**: `sdk/theme/src/tokens.css`, `client-apps/web/src/components/layout/AppShell.tsx`, `client-apps/web/src/components/layout/Sidebar.tsx`
