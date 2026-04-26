# Desktop: Native macOS Tray Icon

**Date**: April 26, 2026

## Summary

Replaced the Stigmer desktop app's macOS tray icon — which was using the full app icon (opaque black background with white logo) — with a proper template image. The tray icon now blends natively with other menu bar icons, automatically tinting to match the system theme.

## Problem Statement

The Stigmer tray icon stood out from every other icon in the macOS menu bar. All system and third-party tray icons (Docker, Cursor, Wi-Fi, Bluetooth, etc.) use monochrome template images with transparent backgrounds that macOS auto-tints. Stigmer was using the full `icon.png` app icon — a white molecular logo on a solid black rounded-rectangle background — making it look out of place.

### Pain Points

- Stigmer icon had an opaque black background while every other tray icon was transparent
- The icon didn't adapt to light/dark menu bar themes
- The full app icon was too detailed and small to be recognizable at 22pt menu bar size
- Brand perception: looked like a dev build rather than a polished product

## Solution

Created a dedicated tray icon asset and enabled Tauri's `icon_as_template` API:

1. Generated a 44x44px (22pt @2x Retina) PNG from the existing `Icon-bw.svg` — black Stigmer molecular logo on a fully transparent background, with a tightly cropped viewBox so the logo fills ~90% of the icon area
2. Added `.icon_as_template(true)` to the `TrayIconBuilder` chain so macOS treats the image as a template — the OS uses only the alpha channel and renders it in the system-appropriate color

## Implementation Details

- **New asset**: `client-apps/desktop/src-tauri/icons/tray-icon.png` — 44x44px RGBA PNG, derived from `public/Icon-bw.svg` with fills changed from `#FEFEFE` to `#000000` and the viewBox cropped from `0 0 34 34` to `3.2 4.3 27.7 25.3` for maximum logo fill
- **Code change**: `client-apps/desktop/src-tauri/src/tray.rs` — switched `include_bytes!` path from `icon.png` to `tray-icon.png` and added `.icon_as_template(true)` to `TrayIconBuilder`
- The existing `icon.png` is unchanged and continues to serve as the app bundle icon, About dialog icon, and Windows/Linux tray icon

## Benefits

- Tray icon blends natively with all other macOS menu bar icons
- Automatically adapts to light and dark menu bar themes
- Logo is larger and more recognizable at menu bar size due to tighter crop
- Professional, polished appearance consistent with macOS design conventions

## Impact

- **macOS only** — `icon_as_template` is a no-op on Windows and Linux, where the existing icon behavior is appropriate
- Zero functional changes to tray menu, tooltip, or click behavior

## Related Work

- Desktop app shell rebuild (`2026-04-26-155351-promote-runners-to-top-level-navigation.md`)
- Native app menu bar (Session 8 of desktop-web-ux-parity project)

---

**Status**: ✅ Production Ready
