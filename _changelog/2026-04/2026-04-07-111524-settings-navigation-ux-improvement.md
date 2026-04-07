# Settings Navigation UX Improvement

**Date**: April 7, 2026

## Summary

Improved the perceived performance of navigating to the Settings area by enabling route prefetching and adding a fade-in transition to the sidebar zone switch. Previously, clicking Settings felt like a full page refresh compared to the instant session-to-session navigation, creating a jarring experience.

## Problem Statement

The app has two distinct navigation mechanisms with very different performance characteristics:

### Pain Points

- **Session navigation** uses `window.history.pushState` + React state, keeping the entire React tree mounted — instant and smooth
- **Settings navigation** used `router.push("/settings")` with no prefetching, triggering a Next.js route transition that loads the JS chunk on click
- The sidebar hard-swapped from `Sidebar` to `ManagementSidebar` with zero animation, making the zone switch feel abrupt
- The stark contrast between instant session navigation and delayed settings navigation made settings feel broken

## Solution

Two targeted changes that address both the latency and the visual abruptness of the zone transition:

1. **Route prefetching**: Replaced `router.push` with a Next.js `<Link>` component so the settings page JS bundle is prefetched on hover
2. **Sidebar fade-in**: Added a keyed wrapper with `animate-in fade-in duration-150` that plays when the sidebar zone changes

## Implementation Details

### `UserMenu.tsx` — Prefetching via `<Link>`

The `SettingsItem` dropdown entry previously used `useRouter()` + `router.push("/settings")` inside an `onClick` handler. This meant Next.js had no opportunity to prefetch the settings page chunk ahead of time.

Changed to `<DropdownMenuItem asChild><Link href="/settings">` which enables Next.js automatic prefetching (the settings JS bundle loads when the link enters the viewport or is hovered). Removed the now-unused `useRouter` import.

### `AppShell.tsx` — Sidebar zone transition

The sidebar container (`w-70` div) already had a width transition for collapse/expand. The content inside was a bare conditional: `{isManagementZone ? <ManagementSidebar /> : <Sidebar />}`.

Added a keyed inner div: `<div key={isManagementZone ? "management" : "session"} className="h-full animate-in fade-in duration-150">`. When the zone changes, React unmounts the old div and mounts the new one, triggering the `tw-animate-css` fade-in animation. The 150ms duration is fast enough to feel responsive while smoothing the visual swap.

Both sidebars are **not** kept mounted simultaneously — `Sidebar` calls `useSessionList()` which triggers API requests and refetch timers, so keeping it mounted in the management zone would waste resources.

## Benefits

- Settings navigation feels instant when the prefetch completes before click (typical case)
- The sidebar swap has visual continuity instead of a jarring hard cut
- Zero performance cost — prefetching is a standard Next.js behavior, and the CSS animation is GPU-accelerated
- No changes to the session navigation path (preserves the existing instant behavior)

## Impact

- **Users**: Settings navigation feels significantly smoother, matching the quality of session navigation
- **Future**: Noted that `experimental.viewTransition` in `next.config.ts` (Next.js 16 + React 19) could provide native browser-level page transitions once it exits experimental status

## Related Work

- `_changelog/2026-04/2026-04-05-143349-settings-layout-zone-separation.md` — original zone separation architecture
- `_changelog/2026-04/2026-04-05-161837-settings-back-to-sessions-state-preservation.md` — session path memory for "Back to Sessions"
- `_changelog/2026-04/2026-04-05-163912-settings-zone-back-forward-navigation.md` — browser back/forward support

---

**Status**: ✅ Production Ready
