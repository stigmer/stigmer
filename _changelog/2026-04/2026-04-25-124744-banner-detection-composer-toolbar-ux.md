# Desktop Banner Detection and Composer Toolbar UX Improvements

**Date**: April 25, 2026

## Summary

Upgraded the desktop app banner with multi-signal detection to auto-hide for existing desktop users, replaced permanent dismissal with campaign-scoped dismissal, and reorganized the session composer toolbar for better information hierarchy and responsive behavior.

## Problem Statement

The desktop app promotion banner and the session composer toolbar had UX gaps that created unnecessary friction for users.

### Pain Points

- The desktop banner showed to all users regardless of whether they already had Stigmer Desktop installed, requiring manual dismissal
- Once dismissed, the banner never returned, even when major new desktop features shipped in later releases
- The composer toolbar placed "Attach" as the leftmost control despite "Workspace" being the higher-signal context setter
- Text labels on toolbar controls caused clutter on narrow viewports
- The workspace editor had no awareness of which runner was selected, despite local file paths being relative to the runner's filesystem

## Solution

Implemented a multi-signal banner suppression system (Tauri context detection, download tracking, local runner detection) with campaign-scoped dismissal, and reorganized the composer toolbar with responsive collapse behavior and runner-workspace contextual hints.

## Implementation Details

### Banner: Desktop Detection (3 files)

- `DesktopAppBanner.tsx` — Added three detection signals that auto-hide the banner:
  - **Tauri context** (`window.__TAURI__`): suppresses banner when running inside the desktop app
  - **Download-completed flag** (`stigmer:desktop-downloaded`): suppresses after `triggerDesktopDownload` succeeds
  - **Local runner flag** (`stigmer:has-local-runner`): suppresses when a local runner hostname is detected
- Exported `useHasDesktopSignal()` hook for the contextual promo and `markLocalRunnerDetected()` for runner detection
- Exported `DOWNLOADED_KEY` constant for cross-module access

### Banner: Campaign-Scoped Dismissal

- Replaced the plain `"true"` dismissal value with a JSON payload containing a `campaign` field and timestamp
- Introduced `BANNER_CAMPAIGN_ID` constant (`"2026.04"`) — bumping this value in future releases resets all dismissals
- Old permanent dismissals from before this change are treated as invalid (not matching current campaign), so the banner reappears once for existing users

### Banner: Download Tracking and Promo Hiding

- `desktop-download.ts` — Added `markDesktopDownloaded()` call after successful download trigger
- `RunnersSection.tsx` — Added local runner detection via `useRunnerList` and `markLocalRunnerDetected()`. Hides `DesktopAppPromo` when `useHasDesktopSignal()` returns true

### Composer: Toolbar Reorder (7 files)

- `ComposerToolbar.tsx` — Swapped Workspace and Attach render order (Workspace first as the higher-signal context setter)
- Added `max-sm:hidden` on the Attach text label for icon-only display on small screens
- `ContextPopover.tsx` — Added `hideLabel` prop for responsive text hiding; applied to Workspace trigger
- `ConfigureMenu.tsx` — Added `max-sm:hidden` on the "Configure" text label
- `RunnerPicker.tsx` — Added `max-sm:max-w-[5rem]` for compact trigger on small screens
- `ModelSelector.tsx` — Added max-width constraints with truncation for responsive display

### Composer: Runner-Workspace Dependency

- `SessionComposer.tsx` — Added `useRunnerList` to resolve the selected runner's display name, passed as `runnerName` to `WorkspaceEditor`
- `WorkspaceEditor.tsx` — Added `runnerName` prop; displays "Paths relative to [runner-name]" hint above local folder input when a specific runner is selected

## Benefits

- Users who already have Stigmer Desktop are no longer nagged with a download banner they don't need
- Campaign-scoped dismissal allows the banner to return for major feature launches without annoying users within a release cycle
- The composer toolbar prioritizes Workspace (the session's codebase scope) over Attach (supplementary file input)
- Responsive collapse eliminates toolbar clutter on narrow viewports
- Runner-workspace hint reduces confusion about which filesystem local paths refer to

## Impact

- **Console users with Desktop**: Banner automatically hidden — zero friction
- **New console users**: Banner lifecycle unchanged (second visit trigger, campaign-scoped dismissal)
- **Session creation UX**: Workspace is now the first toolbar control, matching the user's mental model of "pick a repo, then start working"
- **Mobile/narrow viewports**: Toolbar controls collapse to icons, reducing visual clutter
- **SDK consumers**: `WorkspaceEditor` gains an optional `runnerName` prop; `ContextPopover` gains an optional `hideLabel` prop — both backward compatible

## Related Work

- Desktop download flow: `2026-04-25-085940-desktop-download-flow-dynamic-urls-and-auto-download.md`
- Runner picker in session composer: `2026-04-22-210208-runner-picker-in-session-composer.md`
- Composer toolbar two-tier redesign: `2026-03-20-173755-composer-toolbar-two-tier-redesign.md`

---

**Status**: ✅ Production Ready
