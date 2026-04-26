# Desktop: Fix Invisible Window on Launch

**Date**: April 26, 2026

## Summary

Fixed two bugs that prevented the Stigmer Desktop window from appearing when running `make desktop-dev`. The `single_instance` plugin callback was a no-op (hidden windows were never re-shown on duplicate launch), and `showWindowOnFirstPaint` relied on `requestAnimationFrame` which WebKit skips for not-yet-visible windows — creating a deadlock.

## Problem Statement

After launching `make desktop-dev`, the terminal shows a successful build and the process starts, but no window appears. The dock icon is visible but clicking it does nothing.

### Pain Points

- Closing the desktop window hides it (tray-app behavior) but the process stays alive. Re-running `make desktop-dev` silently exits because the `single_instance` plugin detects the existing process and the callback does nothing.
- Even on a clean first launch, the window never becomes visible because `requestAnimationFrame` does not fire in a hidden WebKit webview, so the `getCurrentWindow().show()` call is never reached.

## Solution

Two targeted fixes:

1. **`single_instance` callback** — show, unminimize, and focus the main window when a duplicate launch is detected (mirrors the existing `show_main_window` pattern in `tray.rs`).
2. **`showWindowOnFirstPaint`** — replaced `requestAnimationFrame` + `setTimeout(0)` with a direct `setTimeout(80)` which fires regardless of window visibility.

## Implementation Details

### Rust: `client-apps/desktop/src-tauri/src/lib.rs`

The `single_instance` callback was empty with a misleading comment about deep-link forwarding. Changed `|_app, _argv, _cwd|` to `|app, _argv, _cwd|` and added the same show/unminimize/focus triplet used by the tray menu's "Open Stigmer" handler.

### TypeScript: `client-apps/desktop/src/main.tsx`

`requestAnimationFrame` is unreliable for hidden windows because WebKit optimizes away animation callbacks when there is no visible surface to composite. Replaced with `setTimeout(80)` — the 80ms delay unblocks the event loop for the initial React render while the native `backgroundColor` (set in `tauri.conf.json` and `index.html` inline script) prevents any white flash.

## Benefits

- `make desktop-dev` reliably shows the window on every launch
- Re-running the command while a hidden instance exists brings the window to the foreground instead of silently exiting
- No changes to the production close-to-hide tray behavior

## Impact

Desktop development workflow. No API, SDK, or web console changes.

## Related Work

- Prior fix: `3ec93c64d fix(desktop): eliminate blank screen flash on startup` — the original `visible: false` + rAF pattern that introduced the deadlock
- Prior fix: `9c5a30939 feat(desktop): replace deep-link auth with localhost callback server in dev mode` — related dev-mode experience improvement

---

**Status**: Production Ready
