# Fix Desktop Icon Oversized Appearance in macOS Dock

**Date**: April 27, 2026

## Summary

Fixed the Stigmer desktop icon appearing oversized in the macOS dock compared to other applications. The icon's source SVG had its black rounded-rectangle background filling 100% of the canvas with zero transparent margin, violating Apple's macOS icon grid which expects ~10% padding per side. Added a reproducible icon generation script that renders all Tauri bundle icons with proper padding.

## Problem Statement

The Stigmer app icon in the macOS dock looked noticeably larger than neighboring icons (Finder, Chrome, Slack, etc.), making the app feel out of place.

### Pain Points

- The source `stigmer_dark.svg` has a `viewBox="0 0 34 34"` with a `<rect width="34" height="34">` that fills the entire canvas edge-to-edge.
- When rendered to 512x512 for `icon.png`, the visible rounded rectangle occupied every pixel -- no transparent breathing room.
- Well-behaved macOS dock icons leave ~10% transparent margin on each side so the visible shape occupies ~80% of the canvas (matching Apple's icon grid where the body is ~824px of 1024px).
- All Tauri icon assets (PNGs, `.icns`, `.ico`, Windows Store tiles) had the same issue.
- No generation script existed for desktop icons -- the PNGs had been placed manually, making regeneration error-prone.

## Solution

Created a `client-apps/desktop/scripts/generate-icons.ts` script that reads the source SVG, renders it at 80% of the canvas (centered on a transparent background), and exports all required icon formats for the Tauri bundle.

## Implementation Details

The script follows the same pattern established by `site/scripts/generate-images.ts`:

1. **Master render**: Reads `stigmer_dark.svg`, renders the artwork at 80% of a 1024x1024 canvas via `sharp`, composited centered onto a transparent background. This gives ~10% padding per side.
2. **Tauri PNGs**: Downscales to 32, 64, 128, 256 (128@2x), and 512 (icon.png).
3. **macOS `.icns`**: Builds a temporary `.iconset` directory with all required sizes (16 through 1024, including @2x variants) and converts via `iconutil`.
4. **Windows `.ico`**: Generates multi-resolution ICO (16, 32, 48, 256) via `png-to-ico`.
5. **Windows Store tiles**: Generates all `Square*.png` and `StoreLogo.png` variants.
6. **Tray icon untouched**: `tray-icon.png` is deliberately excluded -- tray icons have different design requirements (tight/compact).

Key design decisions:
- **Padding applied at generation time**, not in the source SVG. The designer's original SVG is preserved for other uses (web, marketing).
- **`iconutil` for `.icns`** -- the official Apple tool, no npm approximation needed.
- **Script is self-contained** in the desktop package with its own `stigmer_dark.svg` copy.

## Benefits

- The Stigmer icon now sits at the same visual weight as system and third-party apps in the macOS dock.
- Icon generation is reproducible via `npm run generate:icons -w desktop` -- no manual asset placement.
- All 15 regenerated icon assets are consistent (same padding ratio across all sizes).

## Impact

- **Desktop app users** (macOS): Icon no longer looks oversized in the dock.
- **Desktop app users** (Windows): Store tile icons also get consistent padding.
- **Maintainers**: Future icon updates are a single command instead of manual asset wrangling.

## Files Changed

| File | Change |
|------|--------|
| `client-apps/desktop/scripts/generate-icons.ts` | New generation script |
| `client-apps/desktop/public/stigmer_dark.svg` | Source SVG (local copy for self-contained generation) |
| `client-apps/desktop/package.json` | Added `generate:icons` script, `sharp`, `png-to-ico`, `tsx` devDependencies |
| `client-apps/desktop/src-tauri/icons/*` | All icon assets regenerated with 10% padding (15 files: PNGs, `.icns`, `.ico`) |
| `package-lock.json` | Updated for new devDependencies |

---

**Status**: ✅ Production Ready
