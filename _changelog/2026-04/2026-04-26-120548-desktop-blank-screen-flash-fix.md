# Fix Desktop App Blank Screen Flash on Startup

**Date**: April 26, 2026

## Summary

Eliminated the white/black screen flash that appeared when launching Stigmer Desktop by implementing the industry-standard "hidden window + show-on-ready" pattern used by Slack, Linear, VS Code, and other professional desktop apps. The fix spans three layers: Tauri native window configuration, HTML/CSS pre-paint background, and JavaScript entry point restructuring.

## Problem Statement

When launching Stigmer Desktop via `make desktop-dev` (or the production binary), users saw a brief blank white or black screen before the app content rendered. This created an unprofessional first impression and signaled a lack of polish that is unacceptable for a platform of Stigmer's ambition.

### Pain Points

- Native Tauri window appeared immediately with no `backgroundColor` set, showing the OS default (white on light, black on dark)
- `index.html` body had no background color — the webview default showed through the empty `#root` div
- `main.tsx` used a dynamic `import("./App")` creating an async chunk-loading gap where zero React content existed
- `tauri-plugin-window-state` persisted `visible: true`, overriding any attempt to start the window hidden

## Solution

Applied a three-layer fix following the same pattern used by Slack, VS Code, and other state-of-the-art desktop apps:

1. **Tauri native layer**: Hide the window on creation, show it only after React has painted
2. **HTML/CSS layer**: Match the expected theme background before any JS runs
3. **JavaScript layer**: Remove the async import gap and signal window readiness after first paint

## Implementation Details

### Layer 1: Tauri Native Window — Hide Until Ready

- **`tauri.conf.json`**: Added `"visible": false` and `"backgroundColor": [36, 36, 36, 255]` to the main window config. The window starts invisible; the background color is a safety-net fallback matching the monochrome dark theme.
- **`lib.rs`**: Configured `tauri-plugin-window-state` with `StateFlags::all() & !StateFlags::VISIBLE` to exclude the VISIBLE flag from state persistence. This prevents the plugin from overriding `visible: false` with a saved `visible: true` (a known issue documented in tauri#5170 and tauri#7669).
- **`capabilities/default.json`**: Added `"core:window:allow-show"` permission so the frontend JS can call `getCurrentWindow().show()`.

### Layer 2: HTML/CSS — Match Background Before JS Runs

- **`index.html`**: Added a blocking inline `<script>` in `<head>` that reads `prefers-color-scheme` and immediately sets `backgroundColor` and `color` on `document.documentElement`. This ensures the very first paint uses the correct theme background — before Vite's CSS bundle even loads.
- **`globals.css`**: Added `background-color: var(--stgm-background)` and `color: var(--stgm-foreground)` to the `body` rule. Once CSS tokens load, the body transitions from the inline script's hardcoded approximation to the exact token value.

### Layer 3: JavaScript — Eliminate Empty-Root Gap, Signal Ready

- **`main.tsx`**: Replaced the async `import("./App")` with a static `import { App } from "./App"`, eliminating the chunk-loading window where `#root` was empty. Added `showWindowOnFirstPaint()` — a `requestAnimationFrame` + `setTimeout(0)` pattern that calls `getCurrentWindow().show()` after the browser has committed the first painted frame to the compositor.

## Benefits

- Zero-flash startup: window appears with fully rendered content, matching professional desktop app behavior
- Works correctly in both light and dark OS color schemes
- Applies to both dev and production builds identically
- No splash screen complexity — simpler implementation with the same user-visible result
- Window position/size restoration via `tauri-plugin-window-state` continues to work (only VISIBLE flag is excluded)

## Impact

- **Desktop users**: First-launch experience is now on par with Slack, Linear, and VS Code
- **Production builds**: Same fix applies — the `visible: false` + `show()` pattern works identically in bundled releases
- **SDK / Web Console**: Not affected — this is a desktop-only change (the web app has a similar but distinct issue to address separately)

## Related Work

- [Desktop Tauri scaffolding](2026-04-23-124833-stigmer-desktop-tauri-scaffolding.md)
- [Desktop native features](2026-04-23-181141-desktop-native-features-t08.md)
- [Desktop login screen redesign](2026-04-26-101322-desktop-login-screen-ux-redesign.md)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
