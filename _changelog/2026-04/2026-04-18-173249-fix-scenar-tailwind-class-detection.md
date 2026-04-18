# Fix @scenar/react Tailwind v4 class detection

**Date**: April 18, 2026

## Summary

Interactive demo components from `@scenar/react` (progress bar, play button overlays, transport controls) were invisible on the Stigmer docs site because Tailwind v4 never scanned the package's JS files. The root cause was a combination of incorrect `@source` paths in the consumer CSS and a missing self-registering `@source` directive in the `@scenar/react` package itself.

## Problem Statement

The Scenar player components rendered structurally correct HTML, but their Tailwind utility classes (e.g. `bg-foreground/25`, `bg-black/50`, `backdrop-blur-sm`, `ring-white/30`) were purged from the CSS output. The result was a progress bar with no background color, play button overlays with no glow or backdrop, and transport controls that only partially worked because some of their classes happened to exist in other scanned packages.

### Pain Points

- Progress bar completely invisible after playback starts
- Play/pause overlay buttons hard to see on dark backgrounds
- Debugging was misleading because some classes worked (shared with `@stigmer/react`) while others didn't
- Multiple attempted fixes (opacity bumps, `@source inline()` safelists) failed because they didn't address the root cause

## Solution

Aligned `@scenar/react` with the pattern already used by `@stigmer/react` and `fumadocs-ui`: each package ships a `@source` directive inside its own CSS file, so Tailwind discovers component classes through package-relative paths that always resolve correctly.

## Implementation Details

### Root cause analysis

1. **Wrong relative paths**: The `@source "../node_modules/..."` directives in `site/src/app/globals.css` resolved relative to the CSS file, pointing to `site/src/node_modules/` which doesn't exist. The real `node_modules` is at `site/node_modules/`.

2. **Other packages worked by coincidence**: `fumadocs-ui/css/preset.css` ships `@source '../dist/**/*.js'` and `@stigmer/react/src/styles.css` ships `@source "./**/*.{ts,tsx}"` — both package-relative paths that resolve correctly regardless of consumer CSS file location.

3. **@scenar/react had no `@source`**: Its `theme.css` only defined CSS custom properties. No scanning directive meant Tailwind never saw the package's component classes.

### Changes

**Scenar repo** (`@scenar/react` v0.1.10):
- Added `@source "./**/*.js"` to `packages/react/src/theme/tokens.css` (which gets copied to `dist/theme.css` during build). When a consumer imports `@scenar/react/theme.css`, Tailwind now automatically discovers all sibling JS files.

**Stigmer repo**:
- Removed three dead `@source` directives from `globals.css` (fumadocs-ui, @stigmer/react, @scenar/react — all either incorrect paths or redundant with package-internal scanning)
- Removed the brittle `@source inline()` safelist
- Upgraded `@scenar/*` packages from 0.1.8 to 0.1.10

### Additional fixes shipped in earlier v0.1.9/v0.1.10

- Play button overlays: stronger backdrop (`bg-black/50` up from `/40`), wider `backdrop-blur-sm`, white glow (`shadow-[0_0_30px_rgba(255,255,255,0.3)]`) and ring for visibility on dark backgrounds
- Progress bar track opacity bumped from `/15` to `/25`
- Controls kept DOM-mounted (opacity animation instead of mount/unmount) so progress bar refs stay alive across auto-hide cycles

## Benefits

- All `@scenar/react` utility classes now appear in the Tailwind CSS output — verified by building and checking for `bg-foreground/25`, `bg-black/50`, `bg-white/90`, `backdrop-blur-sm`, `ring-white/30`, `hover:h-1.5`
- No consumer-side configuration needed — importing `@scenar/react/theme.css` is sufficient
- No manual safelist to maintain — new classes added to the package are automatically detected
- Consistent architecture across all three Tailwind-using packages

## Impact

- **Docs site**: All interactive demo player controls (progress bar, play/pause overlays, transport buttons) now render with full styling
- **@scenar/react consumers**: Any project importing `theme.css` gets automatic Tailwind class scanning — no `@source` configuration needed
- **Maintenance**: Eliminates a class of "invisible styling" bugs where components render correct HTML but have no CSS

## Related Work

- Scenar commits: `1f7954e` (keep controls DOM mounted), `915df0c` / `ccf8d1b` (play button visibility), `42315b1` (add @source to theme.css)
- Stigmer commit: `b8f1d126` (consumer cleanup and upgrade)

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (including root cause investigation)
