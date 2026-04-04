# Remove Playwright Video Export Pipeline

**Date**: April 4, 2026

## Summary

Removed the superseded Playwright-based video export pipeline, completing the Remotion migration (Phase 5 of 5). Deleted 662 lines across 10 files — the export script, route pages, dependency, Makefile targets, and dead code paths in ScenarioPlayer — leaving Remotion as the single video rendering path.

## Problem Statement

After Phases 1-4 established the Remotion pipeline as a working replacement for Playwright video recording, two parallel pipelines coexisted in the codebase. The old Playwright pipeline was dead code — fully superseded but still present, creating maintenance burden and potential confusion.

### Pain Points

- `scripts/export-videos.ts` (496 lines) was dead code — never needed again
- `playwright` remained as a devDependency, adding install weight and lockfile bloat
- Three Next.js route pages under `app/demos/export/` existed solely for Playwright navigation
- ScenarioPlayer contained two dead effects and one dead data attribute for Playwright signaling
- Makefile listed both old (`export-videos`, `install-playwright`) and new (`render-videos`) targets

## Solution

Surgical removal of all Playwright-specific code, dependencies, configuration, and dead code branches. No new code written — pure deletion and cleanup.

## Implementation Details

**Deleted files (4):**
- `site/scripts/export-videos.ts` — Playwright recording + FFmpeg compositing script
- `site/src/app/demos/export/layout.tsx` — export route layout
- `site/src/app/demos/export/[scenario]/page.tsx` — per-scenario export page
- `site/src/app/demos/export/[scenario]/ExportShell.tsx` — full-viewport shell for Playwright capture

**Updated files (6):**
- `site/package.json` — removed `playwright` devDependency and `export-videos` script
- `site/Makefile` — removed `export-videos`, `export-video`, `install-playwright` targets; removed `.video-tmp` from `clean`
- `site/.gitignore` — removed `.video-tmp/` entry
- `site/src/app/robots.ts` — removed `/demos/export/` from disallow list
- `site/src/components/docs/demos/engine/ScenarioPlayer.tsx` — removed `__exportTimeline` effect, Playwright auto-play effect, `data-playback-complete` attribute
- `site/yarn.lock` — regenerated without playwright/playwright-core

**Preserved (by design):**
- `VideoExportContext` — still used by Remotion's `DemoVideo.tsx`
- `isVideoExport` check in IntersectionObserver guard — defense-in-depth alongside `timeSource`
- `playbackComplete` variable — still used as timer guard; only the DOM attribute was removed

## Benefits

- 662 lines of dead code removed
- `playwright` and `playwright-core` removed from the dependency tree
- Single video rendering path — no ambiguity about which pipeline to use
- Cleaner Makefile with only Remotion targets
- ScenarioPlayer is simpler with two fewer effects

## Impact

- **Dev experience**: `make render-videos` is the only video command — no confusion with legacy `export-videos`
- **Install time**: Playwright binaries no longer downloaded
- **Codebase clarity**: No dead Playwright code to maintain or confuse new contributors

## Related Work

- Predecessor: `2026-04-04-132652-remotion-video-export-phase-1-setup.md` (Phase 1)
- Predecessor: `2026-04-04-145117-remotion-scenario-compositions-and-cursor-fix.md` (Phases 2-3)
- Predecessor: `2026-04-04-151137-remotion-programmatic-render-script.md` (Phase 4)
- Origin: `2026-04-03-173643-video-export-pipeline.md` (original Playwright pipeline)

---

**Status**: ✅ Production Ready
**Timeline**: Phase 5 of the Remotion migration (project 20260403.02)
