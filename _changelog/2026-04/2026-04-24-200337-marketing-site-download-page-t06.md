# Marketing Site Download Page (T06)

**Date**: April 24, 2026

## Summary

Added a `/download` route to the marketing site with platform-detected download buttons for Stigmer Desktop. The page auto-detects the visitor's OS and architecture, highlights the recommended installer, and shows all five platform options with direct links to GitHub Release artifacts. This is the first distribution surface for the desktop app — all future promotion (console CTAs, nav links, nudge banners) will point here.

## Problem Statement

The Stigmer Desktop app (shipped in the 20260423.03 project) had no public download surface. Users could only find installers by navigating GitHub Releases directly. The desktop guide docs (T03) and CLI runner guides (T04) needed a canonical download destination to link to, and the upcoming console promotion tasks (T08–T10) need a stable external URL.

### Pain Points

- No discoverable download page for the desktop app
- No platform detection — users had to manually find the correct installer for their OS and architecture
- No centralized configuration for release version and artifact filenames
- Desktop guide docs had nowhere to send readers for installation

## Solution

Created a focused, utilitarian download page following the existing marketing site patterns (PricingPage as reference). The page is a distribution surface, not a marketing page — short hero, platform cards with auto-detection, guide links, and nothing else.

## Implementation Details

### New files

- **`site/src/app/download/page.tsx`** — Route entry with Next.js metadata (title, description, OpenGraph tags). Follows the exact pattern from `pricing/page.tsx`.
- **`site/src/components/pages/DownloadPage.tsx`** — Client component with three sections:
  1. **Hero**: "Stigmer Desktop" heading, one-sentence value prop, version badge linking to the GitHub release tag.
  2. **Platform cards**: 5 cards in a responsive grid (macOS Apple Silicon, macOS Intel, Windows 64-bit, Linux .deb, Linux .AppImage). Client-side OS detection highlights the recommended card with `bg-card` treatment and a "Recommended" label.
  3. **"After you install"**: Three guide links to existing doc pages (install, manage-runners, CLI local-runner).

### Modified files

- **`site/src/lib/constants.ts`** — Added `DESKTOP_CONFIG` object centralizing version (`0.1.0`), release tag (`desktop-v0.1.0`), and platform artifact definitions. Added `getDownloadUrl()` helper that constructs GitHub Release download URLs. Added `DesktopPlatform` type export.
- **`site/src/components/ui/icon.tsx`** — Added `Download` and `Monitor` icons from Lucide to the icon map.

### Platform detection approach

Client-side only (Next.js static export). On mount:
1. Parses `navigator.userAgent` for OS (macOS / Windows / Linux).
2. For macOS, attempts `navigator.userAgentData.getHighEntropyValues(['architecture'])` to distinguish Apple Silicon from Intel. Falls back to Apple Silicon (majority of active Macs).
3. If detection fails entirely, no card is highlighted — all shown equally.

### Platform brand icons

Apple, Windows, and Linux logos are inline SVGs in the page component. Lucide does not carry brand marks, so these follow the existing pattern of standalone brand icon components (`discord-icon.tsx`, `stigmer-icon.tsx`).

## Benefits

- **Single source of truth**: One edit to `DESKTOP_CONFIG` in `constants.ts` updates every download link when a new version ships.
- **Platform detection**: Visitors see their recommended installer immediately without scanning a list.
- **Cross-linked**: Guide links bridge the download → documentation flow. Users download, then follow the install guide.
- **Consistent**: Same shell, animation tokens, typography, and responsive patterns as PricingPage and other marketing pages.

## Impact

- **Users**: Can discover and download Stigmer Desktop from a proper marketing site page instead of navigating GitHub Releases.
- **Documentation**: Desktop guide (T03) and CLI runner guides (T04) now have a canonical download destination to reference.
- **Console promotion** (T08–T10): Will link to `/download` as the external destination for "Get Desktop App" CTAs.
- **Nav/footer** (T07): Ready to wire into `NAV_LINKS` and `FOOTER_LINKS`.

## Related Work

- **T03**: Desktop app guide (3 pages under `docs/guides/desktop/`) — linked from the download page's "After you install" section.
- **T04**: CLI runner guides (3 pages under `docs/guides/runners/`) — linked for CLI-based runner management.
- **T07** (next): Marketing site nav/footer wiring — will add "Download" to navigation constants.
- **T08–T10**: Console promotion surfaces — will link to `/download`.
- **20260423.03**: Stigmer Desktop Tauri app — the app being distributed.

---

**Status**: ✅ Production Ready
**Timeline**: Single session
