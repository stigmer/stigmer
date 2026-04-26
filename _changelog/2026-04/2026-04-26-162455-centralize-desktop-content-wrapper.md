# Centralize Desktop Content Wrapper

**Date**: April 26, 2026

## Summary

Added a centralized scroll and block-context wrapper to the desktop `AppShell`, matching the pattern already established in the web `AppShell`. This eliminates per-page layout workarounds from `LibraryLayout` and `SettingsLayout`, fixes the Runners page spreading edge-to-edge, and ensures every future route inherits correct `mx-auto` behavior and scroll support for free.

## Problem Statement

The desktop `AppShell` rendered `<Outlet />` directly into a `flex-direction: column` container. In CSS flexbox, `margin: auto` on a flex child overrides `align-items: stretch`, causing children to collapse to intrinsic content width rather than filling the parent. Every page using `mx-auto max-w-*` for centered, constrained content was broken unless it added its own block-context wrapper.

### Pain Points

- Library cards collapsed to minimum content width (~300px) instead of filling the grid columns -- required a per-page `div.h-full.overflow-y-auto` workaround
- Settings layout had its own identical workaround
- Runners page had no workaround at all -- content spread from sidebar edge to window edge with no max-width constraint
- Any new page added to the desktop app would inherit the same broken layout unless the developer knew to add the wrapper
- The web `AppShell` already solved this with a single centralized `div.overflow-y-auto` wrapper -- the desktop app was inconsistent

## Solution

Added the same centralized wrapper to the desktop `AppShell` that the web app already has, then removed the now-redundant per-page workarounds and brought the Runners page into alignment.

## Implementation Details

**AppShell centralized wrapper** (`client-apps/desktop/src/shell/AppShell.tsx`):

Added `div.min-w-0.flex-1.overflow-y-auto` between the flex `main` and `<Outlet />`. This single div provides:
- A block formatting context where `mx-auto` works correctly on all descendants
- Scroll support for all pages without per-page opt-in
- A fixed height reference so full-height pages (`h-full`) can fill the visible area

**LibraryLayout cleanup** (`client-apps/desktop/src/pages/library/LibraryLayout.tsx`):

Removed the `div.h-full.overflow-y-auto` wrapper added in the previous session's card alignment fix. The `mx-auto max-w-4xl` div now works correctly because its parent is a block context, not a flex column.

**SettingsLayout cleanup** (`client-apps/desktop/src/pages/settings/SettingsLayout.tsx`):

Removed the same `div.h-full.overflow-y-auto` pattern. Replaced with a fragment since the only content is the sr-only heading and the centered container.

**Runners page alignment** (`client-apps/desktop/src/routes.tsx`, `client-apps/desktop/src/pages/runners/RunnersPage.tsx`):

Added `mx-auto max-w-4xl px-6 py-8` wrapper to the Runners route, matching the Library pattern. Updated the Runners component to become flow content: root no longer uses `flex h-full` (was filling the entire main area edge-to-edge), inner panel no longer uses `p-6` (route wrapper provides padding). When the log viewer opens, the container switches to `flex max-h-[70vh]` for a constrained split-panel layout.

**Runners file relocation**: Moved Runners files from `pages/settings/` to `pages/runners/` to match the top-level route structure established in the previous session. Updated stale `/settings/runners` references in `useAppShortcuts`, `useDeepLinkHandler`, and web `DesktopAppBanner` comments.

## Benefits

- Every page in the desktop app now inherits correct `mx-auto` behavior and scroll support from the centralized wrapper -- no per-page workarounds needed
- Desktop content layout architecture matches the web app exactly
- New pages added in the future cannot accidentally break -- the infrastructure is inherited
- Runners page now has the same centered, constrained layout as Library and Settings

## Impact

- **Desktop users**: Runners page is now properly constrained and centered, consistent with Library and Settings
- **Codebase**: Eliminated two redundant per-page wrappers, centralized the pattern in one place. File structure matches route structure (runners files in `pages/runners/`)
- **Web app**: Unaffected (already had the centralized wrapper; only comment updates in `DesktopAppBanner.tsx`)

## Related Work

- Desktop Library Card Alignment Fix (2026-04-26) -- the per-page workaround this change supersedes
- Promote Runners to Top-Level Navigation (2026-04-26) -- established `/runners` as a top-level route
- Desktop-Web UX Parity project -- broader initiative to align desktop and web experiences

---

**Status**: Production Ready
**Timeline**: Single session
