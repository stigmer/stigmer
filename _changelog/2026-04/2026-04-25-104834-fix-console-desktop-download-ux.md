# Fix Console Desktop Download UX

**Date**: April 25, 2026

## Summary

Fixed five issues in the console's desktop download flow that caused misleading error messages, forced redirects, popup-blocker risks, and silent failures. The download button now provides accurate, actionable feedback when the download cannot be triggered directly, and correctly handles universal macOS binaries.

## Problem Statement

When a user clicked "Get Desktop App" in the console (user menu, desktop banner, or runners page), `triggerDesktopDownload()` ran two async operations in parallel — platform detection and GitHub release fetch. Any failure in either step triggered the same `openFallbackDownloadPage()` function, which opened `stigmer.ai/download` in a new tab and showed a toast saying "We couldn't detect your platform automatically" — even when the real issue was the GitHub API being unreachable.

### Pain Points

- **Misleading error message**: All failures blamed platform detection, regardless of actual cause (Nielsen's Heuristic #9 violation)
- **Forced redirect**: `window.open()` opened a new tab without user consent, causing an unexpected context switch (Nielsen's Heuristic #3 violation)
- **Popup-blocker risk**: `window.open()` after `await Promise.all()` breaks the synchronous event handler chain, causing modern browsers to intermittently block the popup
- **macOS arch mismatch**: The `.dmg` asset was classified as `arch: "arm64"` but CI builds a universal binary (`universal-apple-darwin`), so Intel Mac users always hit the fallback
- **Silent failures**: No diagnostic logging — no way to determine which step failed without a debugger

## Solution

Replaced the single `openFallbackDownloadPage()` catch-all with failure-specific Sonner toasts that include a "Download page" action button. The user stays in the console, sees what went wrong, and can choose to visit the download page. No forced redirects, no popup-blocker risk.

## Implementation Details

All changes in `client-apps/web/src/lib/desktop-download.ts` (87 insertions, 28 deletions). No changes to call sites — `UserMenu.tsx`, `DesktopAppBanner.tsx`, and `RunnersSection.tsx` continue to call `triggerDesktopDownload()` unchanged.

### Structured error results

`fetchLatestDesktopRelease()` now returns a `ReleaseFetchResult` discriminated union instead of `ReleaseResult | null`:

- `{ ok: true, release }` — success
- `{ ok: false, reason: "fetch-failed", status? }` — API unreachable or non-200
- `{ ok: false, reason: "no-assets" }` — release exists but has no matching desktop assets

### Failure-specific toasts with action button

Removed `openFallbackDownloadPage()` entirely. Three distinct failure paths now show targeted `toast.warning()` messages with a `DOWNLOAD_PAGE_ACTION` button that opens the download page via a user click (which avoids popup blockers):

- **Platform unknown**: "Couldn't detect your platform."
- **Release fetch failed**: "Couldn't reach the download server."
- **No matching asset**: "No installer found for {macOS/Windows/Linux}."

### macOS universal binary fix

Changed `.dmg` asset pattern from `arch: "arm64"` to `arch: null`. Updated `findAssetForPlatform()` so `null` arch on an asset means "universal — matches any detected architecture." Intel Mac users will now correctly match the `.dmg` asset.

### Diagnostic logging

Added `console.warn("[desktop-download] ...")` at each failure point with structured context: user agent (platform detection), HTTP status code (fetch failure), or available asset list (no match).

## Benefits

- **Accurate feedback**: Users see the actual reason their download didn't start
- **User control**: No forced tab opens — users choose whether to visit the download page
- **Popup-safe**: Action button opens the download page from a user click, not an async callback
- **Intel Mac support**: Universal `.dmg` now matches both arm64 and x64 architectures
- **Debuggable**: `console.warn` with structured context at every failure point

## Impact

- **End users**: Clear, actionable feedback when the download can't be triggered directly
- **Intel Mac users**: Downloads now work instead of silently falling back
- **Maintainers**: Diagnostic logging makes production issues visible without a debugger

## Related Work

- Desktop download flow: dynamic URLs and auto-download (2026-04-25)
- Console contextual desktop app promotion T08–T11 (2026-04-24)
- Marketing site `/download` page T06 (2026-04-24)

---

**Status**: ✅ Production Ready
