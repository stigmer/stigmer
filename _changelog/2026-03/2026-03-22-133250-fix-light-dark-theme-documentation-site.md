# Fix Light/Dark Theme for Documentation Site

**Date**: March 22, 2026

## Summary

Fixed the documentation site's light and dark themes to render as distinct, properly branded palettes. Previously both modes were identical — always dark — because the CSS applied the same color values to both `:root` and `.dark`, and the HTML hardcoded `className="dark"`. The "Install the CLI" code block at the page bottom was invisible due to zero contrast. Now Fumadocs' built-in theme toggle works correctly, both modes have high-contrast readable content, and code blocks render with theme-appropriate syntax highlighting.

## Problem Statement

Users reported that toggling between light and dark mode had no visible effect, and the "Get started" code block at the bottom of the docs landing page was completely invisible.

### Pain Points

- Light and dark modes rendered identically (always dark)
- Code blocks were invisible — dark text on dark background with no contrast
- The Fumadocs theme toggle appeared functional but had no effect
- The marketing homepage's CodeBlock component was hardcoded to `oneDark` only

## Solution

Implemented a proper dual-palette color system by separating light (`:root`) and dark (`.dark`) CSS variable definitions, removing the hardcoded dark class from the HTML root, and making code block components theme-aware.

## Implementation Details

### Root layout (`layout.tsx`)
- Removed `className="dark"` from `<html>` — next-themes (via Fumadocs' `RootProvider`) now manages the theme class at runtime
- Added `suppressHydrationWarning` to prevent React hydration mismatches
- Updated `themeColor` viewport meta to serve mode-specific values via `prefers-color-scheme` media queries

### CSS design system (`globals.css`)
- **Light palette at `:root`**: Blue-gray backgrounds (`hsl(220 23% 97%)`), near-black text, white cards/popovers, subdued glow effects (15–20% opacity), semi-transparent white glass
- **Dark palette at `.dark`**: Near-black with blue undertone, light text, intensified glows (30–40% opacity), dark glass
- **Fumadocs overrides split**: `--color-fd-*` variables now have distinct light and dark definitions instead of the previous combined `.dark, :root` selector
- Shared tokens (glow sizes, blur intensities, animation durations, border radius) remain in `:root` and are inherited by both modes

### CodeBlock component (`code-block.tsx`)
- Imported `oneLight` alongside existing `oneDark` from react-syntax-highlighter
- Added `useTheme()` from next-themes to both `CodeBlock` and `CodeSnippet`
- Dynamically selects syntax theme based on `resolvedTheme`

### Minor fixes
- `MobileMenu.tsx`: `bg-black/60` → `bg-foreground/60` for theme-aware backdrop overlay
- `Hero.tsx`: Grid pattern SVG now uses neutral gray fill with mode-aware opacity (`0.06` light / `0.02` dark)

## Benefits

- **Distinct visual modes**: Light mode is clean and professional; dark mode retains the terminal-inspired aesthetic
- **Code blocks are readable**: Both Fumadocs (Shiki) and marketing (react-syntax-highlighter) code blocks render with proper contrast in both modes
- **Theme toggle works**: Fumadocs' built-in sun/moon toggle functions correctly out of the box
- **Brand consistency**: Same electric blue primary and purple accent carry across both palettes
- **No new dependencies**: `next-themes` and `oneLight` were already available via Fumadocs and react-syntax-highlighter

## Impact

- **Documentation site**: All docs pages now have proper light/dark theming
- **Marketing homepage**: Hero, feature sections, and Quickstart code blocks adapt to both modes
- **End users**: Can use their preferred color scheme without visibility issues

## Related Work

- Session 3: T06 — Fumadocs Integration (established the docs layout and RootProvider)
- Previous: Initial Stigmer design system in `globals.css`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
