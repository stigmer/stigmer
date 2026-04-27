# Fix macOS Dock Tooltip Showing "stigmer-desktop" Instead of "stigmer"

**Date**: April 27, 2026

## Summary

Renamed the Tauri Cargo package from `stigmer-desktop` to `stigmer` so the macOS dock tooltip displays the correct app name. The previous name leaked the Rust binary name into the dock, which was visible to end users when hovering over the app icon.

## Problem Statement

When hovering over the Stigmer desktop icon in the macOS dock, the tooltip showed "stigmer-desktop" instead of "stigmer".

### Pain Points

- The dock tooltip exposed the internal Cargo binary name to users
- Inconsistent branding — the app menu, window title, and bundle all read "Stigmer", but the dock said "stigmer-desktop"
- macOS derives the dock tooltip from the process name, which in turn comes from the Cargo `[package] name`

## Solution

Renamed the Cargo package in `Cargo.toml` from `stigmer-desktop` to `stigmer`. This changes the compiled binary name, which macOS uses for the dock tooltip. The `productName` in `tauri.conf.json` was already set to `"Stigmer"` for release bundles, so no changes were needed there.

## Implementation Details

- **`client-apps/desktop/src-tauri/Cargo.toml`** — changed `[package] name` from `"stigmer-desktop"` to `"stigmer"`
- **`client-apps/desktop/src-tauri/src/menu.rs`** — updated doc comment referencing the old binary name
- **`client-apps/desktop/src-tauri/Cargo.lock`** — regenerated to reflect the new package name

## Benefits

- Dock tooltip now shows "stigmer" — consistent with the rest of the app branding
- No functional changes; purely a naming fix

## Impact

Desktop app users on macOS will see the corrected name in the dock tooltip.

---

**Status**: ✅ Production Ready
