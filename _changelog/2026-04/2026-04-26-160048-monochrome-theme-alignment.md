# Align Web Console to Desktop Monochrome Theme and Remove Version Footer

**Date**: April 26, 2026

## Summary

Unified the visual identity across the Stigmer desktop and web console by switching the web app from the default teal palette to the monochrome preset, matching the desktop app's established look. Also removed the version footer from the desktop sidebar, decluttering the bottom navigation area.

## Problem Statement

The desktop app and web console had diverging visual identities despite sharing the same SDK `UserMenu` component and theme infrastructure. The desktop shipped with `preset="monochrome"` — a clean, zero-chroma, editorial aesthetic inspired by Linear/Vercel/Notion. The web console used the default teal palette, creating an inconsistent experience for users who switch between surfaces.

### Pain Points

- Users moving between desktop and web encountered visually distinct products despite identical functionality
- The web app's `layout.tsx` contained a dead flash-prevention script that read `stgm-theme-preset` from localStorage, but no UI existed for users to change it — orphaned infrastructure from a removed preset-switching flow
- The desktop sidebar displayed a static version number (`v0.1.0`) that provided no actionable value and consumed space in the navigation footer

## Solution

Three targeted changes to align surfaces and clean up dead code:

1. **Set monochrome preset on the web console's `StigmerProvider`** — both the authenticated transport bridge and the unauthenticated login page now render with `preset="monochrome"`
2. **Remove the dead flash-prevention script** — the inline `<script>` in `layout.tsx` that injected preset classes from localStorage is deleted
3. **Remove `VersionFooter` from the desktop sidebar** — the static version text and its coupled "update available" button are removed, along with all imports that were only used by that component

## Implementation Details

**Files changed (4 files, +4 / -47 lines):**

- `client-apps/desktop/src/shell/Sidebar.tsx` — Deleted the `VersionFooter` component (31 lines) and its render call. Cleaned up four unused imports: `useState` from React, `getVersion` from `@tauri-apps/api/app`, `ArrowUpCircle` from lucide-react, and `useAppUpdaterContext`.
- `client-apps/web/src/providers/StigmerTransportBridge.tsx` — Added `preset="monochrome"` to the `StigmerProvider` that wraps the entire authenticated app tree.
- `client-apps/web/src/auth/login/LoginPageView.tsx` — Added `preset="monochrome"` to the login page's standalone `StigmerProvider` for pre-auth visual consistency.
- `client-apps/web/src/app/layout.tsx` — Removed the inline script that read `stgm-theme-preset` from localStorage and added a CSS class to `<html>`.

**What was preserved:**

- The `@stigmer/theme` presets system remains fully intact for platform builders — all preset CSS files are still imported in `globals.css` and available via `StigmerProvider`'s `preset` prop.
- The `AppUpdaterProvider` and Tauri's native update mechanism remain operational — only the sidebar's secondary update prompt was removed.
- The `next-themes` integration and color mode bridging are unchanged.

## Benefits

- Consistent monochrome visual identity across desktop and web surfaces
- Cleaner desktop sidebar with no wasted space on static version text
- Removal of dead code (flash-prevention script with no corresponding UI)
- Net reduction of 43 lines

## Impact

- **Direct users**: Both desktop and web console now render with the same monochrome design language — zero-chroma, typographic, sharp
- **Login page**: Pre-auth screen now matches the authenticated app's visual identity
- **Platform builders**: No impact — the presets system is unchanged and `StigmerProvider` still accepts any preset ID

## Related Work

- Desktop app shell and SDK architecture established in `bd4c3446f` (session 7)
- Theme presets system defined in `@stigmer/theme` (`sdk/theme/src/presets/`)
- SDK `UserMenu` component with color scheme radios (`sdk/react/src/user/UserMenu.tsx`)

---

**Status**: ✅ Production Ready
