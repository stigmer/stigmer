# Desktop Tauri Runtime Guard

**Date**: April 26, 2026

## Summary

Added a Tauri runtime detection guard to the desktop app entry point so that developers who accidentally open the Vite dev server (`localhost:5173`) in a regular browser see a clear, actionable message instead of a cryptic JavaScript crash.

## Problem Statement

When running `make desktop-dev`, Tauri starts a Vite dev server and opens a native window pointed at it. The native window has Tauri's IPC bridge injected, so all `@tauri-apps/*` API calls work. However, the Vite dev server URL is also reachable from any regular browser.

### Pain Points

- Opening `localhost:5173` in Chrome (a natural developer instinct) caused an immediate crash: "Cannot read properties of undefined (reading 'invoke')"
- The error gave no indication of what went wrong or how to fix it
- Developers unfamiliar with the Tauri architecture would waste time debugging a non-issue

## Solution

A lightweight runtime guard in `main.tsx` that checks for Tauri's `window.__TAURI_INTERNALS__` IPC bridge before rendering the app. When the bridge is absent (regular browser), a minimal developer-facing notice renders instead.

## Implementation Details

- **Detection**: `"__TAURI_INTERNALS__" in window` — the canonical Tauri v2 runtime check
- **Dynamic import**: `App.tsx` (and all its Tauri-dependent imports) is loaded via `import("./App")` only when inside Tauri, preventing any `@tauri-apps/*` module from executing in a regular browser
- **Fallback UI**: A self-contained `TauriRequiredNotice` component using inline styles only — no dependency on the theme system, SDK packages, or Tauri APIs
- **File changed**: `client-apps/desktop/src/main.tsx`

## Benefits

- Eliminates a confusing DX pitfall for any developer working on the desktop app
- Zero runtime cost inside Tauri — the guard is a single property check before the app loads
- No new dependencies, no new files — one focused change to the existing entry point

## Impact

- **Desktop app developers**: No more cryptic crashes when accidentally opening the dev URL in Chrome
- **Production**: No impact — `__TAURI_INTERNALS__` is always present in the Tauri webview, so the app loads identically

## Related Work

- `fix(desktop,sdk): bypass CORS for Auth0 token exchange via Tauri HTTP plugin` — the CORS fix that introduced `tauriFetch` in `App.tsx`, which is the import that crashes outside Tauri

---

**Status**: Production Ready
