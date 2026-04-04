# Next Task: 20260403.02.remotion-video-export

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260403.02.remotion-video-export

**Description**: Replace the Playwright-based video export pipeline with Remotion for pixel-perfect video quality. Remotion renders each frame individually using headless Chrome, eliminating the VP8 quality degradation that plagues the current approach.
**Goal**: Produce high-quality, crisp, readable demo scenario videos with proper audio synchronization using Remotion, replacing the Playwright recordVideo + FFmpeg pipeline.
**Tech Stack**: TypeScript, React, Remotion, FFmpeg, Next.js
**Components**: site/scripts/render-videos.ts, site/video/webpack.ts, site/video/compositions/DemoVideo.tsx, site/video/Root.tsx, site/src/components/docs/demos/engine/TimeSource.tsx

## Current Status

**Created**: 2026-04-03
**Last Session**: 2026-04-04 (Session 4)
**Current Task**: T01 — Replace Playwright Video Export with Remotion
**Status**: COMPLETE — All 5 phases done

## Phase Progress Summary

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Remotion Setup & Hello World | ✅ Complete |
| Phase 2 | Scenario Composition | ✅ Complete |
| Phase 3 | Audio Integration | ✅ Complete |
| Phase 4 | Render Script | ✅ Complete |
| Phase 5 | Cleanup & Validation | ✅ Complete |

## Session Progress (2026-04-04, Session 4)

### What Was Accomplished

- **Deleted old export script**: Removed `scripts/export-videos.ts` (496 lines) — the Playwright recording + FFmpeg compositing pipeline
- **Deleted export route pages**: Removed `app/demos/export/` (layout, page, ExportShell) — Next.js pages that existed solely for Playwright navigation
- **Removed Playwright dependency**: Removed `playwright` from devDependencies and regenerated lockfile
- **Cleaned Makefile**: Removed `export-videos`, `export-video`, `install-playwright` targets and `.video-tmp` from `clean`
- **Cleaned ScenarioPlayer**: Removed two dead Playwright-only effects (`__exportTimeline` logging, auto-play on export) and the `data-playback-complete` data attribute
- **Updated gitignore**: Removed `.video-tmp/` entry, updated comment
- **Updated robots.ts**: Removed `/demos/export/` from disallow list
- **Validated**: Rendered all 10/10 scenarios successfully via `make render-videos` (2m 18s)

### Key Decisions Made

1. **VideoExportContext stays**: Still used by Remotion's `DemoVideo.tsx` to provide `hideControls` and `initialMuted` — not Playwright-specific
2. **`isVideoExport` in IntersectionObserver guard stays**: Defense-in-depth alongside `timeSource` check
3. **`playbackComplete` variable stays**: Still used as a guard in the timer effect — only the `data-playback-complete` DOM attribute was removed
4. **Export route pages fully removed**: Remotion bundles its own React app from `video/index.ts` — never hits Next.js routes

### Files Deleted

- `site/scripts/export-videos.ts`
- `site/src/app/demos/export/layout.tsx`
- `site/src/app/demos/export/[scenario]/page.tsx`
- `site/src/app/demos/export/[scenario]/ExportShell.tsx`

### Files Modified

- `site/package.json` — removed `playwright` devDep and `export-videos` script
- `site/Makefile` — removed old targets, cleaned `.PHONY` and `clean`
- `site/.gitignore` — removed `.video-tmp/`
- `site/src/app/robots.ts` — removed `/demos/export/` from disallow
- `site/src/components/docs/demos/engine/ScenarioPlayer.tsx` — removed dead Playwright code
- `site/yarn.lock` — regenerated without playwright

## Project Completion Summary

The Remotion migration is complete. The video rendering pipeline now:
- Renders each frame as a lossless screenshot (no VP8 degradation)
- Encodes directly to H.264 with AAC audio (no FFmpeg compositing step)
- Uses frame-driven step progression via `TimeSource` (deterministic timing)
- Discovers compositions from the bundle at runtime (no hardcoded lists)
- Renders all 10 scenarios in ~2 minutes

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.02.remotion-video-export/checkpoints/
```

### 2. Current Task
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.02.remotion-video-export/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.02.remotion-video-export/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.02.remotion-video-export/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.02.remotion-video-export/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.02.remotion-video-export/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.02.remotion-video-export/dont-dos/
```

## Predecessor Project

This project continues from **20260403.01.demo-audio-video** (Phase 5: Video
export pipeline), which built the initial Playwright-based recording +
FFmpeg compositing pipeline. That pipeline works end-to-end but produces
low-quality video due to Playwright's VP8 codec. This project replaces
the recording backend with Remotion for pixel-perfect output.

---

*This file provides direct paths to all project resources for quick context loading.*
