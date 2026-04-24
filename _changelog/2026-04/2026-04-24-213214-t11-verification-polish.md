# T11: Verification and Polish — Desktop App Promotion Project

**Date**: April 24, 2026

## Summary

Systematically audited all T01–T10 deliverables across docs, marketing site, and Console. Found and fixed four issues: a stale TODO with wrong installer format in the desktop install guide, dead code in the runners settings page, an effect that re-subscribed on every render in the app shell, and a subtle edge case where the desktop nudge banner could appear on the first visit instead of the second. All builds and lint pass clean.

## Problem Statement

T01–T10 shipped rapidly across three codebases (docs, marketing site, Console). A cross-cutting verification pass was needed to catch inconsistencies, dead code, and edge cases before the project is considered complete.

### Pain Points

- `install.mdx` still had a TODO placeholder and GitHub Releases link from T03, even though T06 delivered the `/download` page. Windows installer format was listed as `.msi` but Tauri produces `.exe` (NSIS).
- `RunnersSection.tsx` had a `listRefetchRef` that was wired to `RunnerListPanel` but never read — confusing for the next person reading the file.
- `AppShell.tsx` Escape keydown effect depended on `[sidebar]`, an unstable object reference from `useSidebarOpen()`, causing the listener to re-subscribe on every render of the root layout component.
- `DesktopAppBanner.tsx` could show the banner during the first visit if any re-render happened after the `FIRST_SEEN` key was seeded — violating the "second visit only" design intent.

## Solution

Four targeted fixes, each isolated to a single file. No architectural changes. All fixes verified with `npm run lint` (0 errors, 0 warnings) and `npm run build` (29 routes, exit 0) for the Console, plus `yarn lint` and `yarn build` for the marketing site.

## Implementation Details

### `docs/guides/desktop/install.mdx`

- Replaced the TODO comment and GitHub Releases link with a proper link to `/download`.
- Updated Windows installer format from `.msi` to `.exe` in the platform table (line 18) and install instructions (line 65). Aligns with `DESKTOP_CONFIG` in `site/src/lib/constants.ts` which specifies `Stigmer_0.1.0_x64-setup.exe` (NSIS format from Tauri 2 `"targets": "all"`).

### `client-apps/web/src/domain/settings/RunnersSection.tsx`

- Removed `listRefetchRef`, `handleRefetchRef`, and the `onRefetchRef` prop from `RunnerListPanel`. Dropped unused `useRef` import.
- The ref was populated but never consumed — `handleLaunch` did not call `listRefetchRef.current()` after a successful launch. If post-launch refetch is needed later, it should be implemented completely rather than left as a dangling ref.

### `client-apps/web/src/domain/_shared/layout/AppShell.tsx`

- Destructured `sidebar.isOpen` and `sidebar.close` into local variables (`sidebarOpen`, `closeSidebar`) before the Escape keydown effect.
- Changed the effect's dependency array from `[sidebar]` (unstable object, new on every render) to `[sidebarOpen, closeSidebar]` (stable primitives — `closeSidebar` is a `useCallback` with empty deps).
- This also eliminated a pre-existing `react-hooks/exhaustive-deps` lint warning on this effect.

### `client-apps/web/src/domain/_shared/layout/DesktopAppBanner.tsx`

- Added a module-level `seededThisSession` flag (`let seededThisSession = false`).
- `getBannerSnapshot()` now returns `false` when the flag is set, preventing the banner from appearing on the first visit regardless of re-renders.
- The flag is set when the `useEffect` seeds `FIRST_SEEN` for the first time, and resets naturally on page reload (module re-evaluation = new visit).

## Benefits

- Documentation now correctly matches the actual installer format and links to the proper download page.
- Console codebase has no dead code in the runners settings page.
- The most-rendered component in the app (`AppShell`) no longer does unnecessary work on every render.
- The desktop nudge banner now strictly follows its documented "second visit only" behavior.

## Impact

- **Documentation**: `install.mdx` now consistent with `DESKTOP_CONFIG` and the `/download` page.
- **Console UI**: No visual changes. Behavioral improvements (effect stability, banner timing) are invisible to users but improve code quality and correctness.
- **No SDK changes**: All fixes are in `client-apps/web` and `docs/` — DD-002/DD-004 compliance maintained.

## Related Work

- **T01–T10**: All prior tasks in project `20260424.01.desktop-app-promotion`.
- **T06** (`6e879ead7`): Marketing site `/download` page — the link target that `install.mdx` now points to.
- **T10** (`927379033`): Console nudge banner — the component with the first-visit edge case fix.

---

**Status**: Production Ready
**Files changed**: 4 (18 insertions, 19 deletions)
