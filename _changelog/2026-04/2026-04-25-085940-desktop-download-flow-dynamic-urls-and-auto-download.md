# Desktop Download Flow: Dynamic URLs and Auto-Download UX

**Date**: April 25, 2026

## Summary

Replaced hardcoded desktop download URLs with dynamic resolution via the GitHub Releases API and upgraded the console's download experience from a website redirect to a Slack-style one-click auto-download with platform detection and installation instructions.

## Problem Statement

The desktop download flow had two distinct issues that combined to make the experience completely broken.

### Pain Points

- **404 download links**: The marketing site constructed download URLs from a hardcoded version (`v0.1.0`) that didn't match any existing GitHub Release tag (actual releases used `v0.0.93`, etc.). Every download link returned a 404.
- **Redirect friction in the console**: All three desktop download touchpoints in the console app (user menu, desktop banner, runners promo) opened `https://stigmer.ai/download` in a new browser tab instead of initiating a download, adding an unnecessary step.
- **Version sync fragility**: The download URL construction depended on keeping version strings synchronized across `tauri.conf.json`, `Cargo.toml`, `package.json`, and `site/src/lib/constants.ts` — a pattern guaranteed to break.

## Solution

Eliminated hardcoded version strings entirely. Both the console and marketing site now resolve download URLs dynamically from `GET /repos/stigmer/stigmer/releases/latest`, matching assets by file extension pattern (`.dmg`, `-setup.exe`, `.deb`, `.AppImage`) and using the `browser_download_url` field directly.

The console download buttons trigger direct browser downloads with a Sonner toast showing platform-specific installation instructions, following the Slack download UX pattern.

## Implementation Details

### New utility: `client-apps/web/src/lib/desktop-download.ts`

- `detectPlatform()` — returns `{ os, arch }` from `navigator.userAgent` and `navigator.userAgentData` (Chromium high-entropy architecture detection for Apple Silicon vs Intel)
- `fetchLatestDesktopRelease()` — calls the GitHub Releases API, classifies assets by extension, caches results for the session
- `triggerDesktopDownload()` — detects platform, resolves download URL, triggers browser download via a temporary anchor element, shows a Sonner toast with install instructions; falls back to the marketing site if anything fails

### Console changes (3 files)

- `DesktopAppBanner.tsx` — `<a>` to marketing site replaced with `<button onClick={triggerDesktopDownload}>`
- `UserMenu.tsx` — `DesktopAppItem` now calls `triggerDesktopDownload()` instead of navigating away
- `RunnersSection.tsx` — `DesktopAppPromo` same pattern

### Marketing site changes (2 files)

- `site/src/lib/constants.ts` — removed `DESKTOP_CONFIG` (hardcoded `v0.1.0`), `getDownloadUrl()`, and all version-specific filenames. Replaced with `DESKTOP_PLATFORMS` (static display metadata), `fetchDesktopRelease()` (GitHub API resolver), and `ResolvedDesktopPlatform` type
- `DownloadPage.tsx` — added `useDesktopRelease()` hook. Renders `LivePlatformCards` with real download URLs when the API succeeds, or `FallbackPlatformCards` with disabled buttons while loading / on failure. Version badge only appears when live data is available.

## Benefits

- **Zero hardcoded versions** — no manual sync required when releasing new versions
- **Self-healing URLs** — always point to the latest release's actual assets
- **One-click download** from the console — no redirect, no extra tab
- **Platform-aware** — detects macOS (Apple Silicon vs Intel), Windows, Linux automatically
- **Graceful degradation** — falls back to the marketing site download page if the GitHub API is unreachable
- **Zero CI changes** — the release pipeline is untouched

## Impact

- **End users**: Desktop download works from the console with a single click
- **Marketing site visitors**: Download links resolve correctly once desktop artifacts are published
- **Maintainers**: No version strings to keep in sync across 4+ files

## Related Work

- Desktop release CI and Windows build fixes (2026-04-25)
- Console contextual desktop app promotion (T08-T11, 2026-04-24)
- Marketing site `/download` page (T06, 2026-04-24)

---

**Status**: ✅ Production Ready
