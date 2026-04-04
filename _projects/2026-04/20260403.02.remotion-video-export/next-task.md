# Next Task: 20260403.02.remotion-video-export

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260403.02.remotion-video-export

**Description**: Replace the Playwright-based video export pipeline with Remotion for pixel-perfect video quality. Remotion renders each frame individually using headless Chrome, eliminating the VP8 quality degradation that plagues the current approach.
**Goal**: Produce high-quality, crisp, readable demo scenario videos with proper audio synchronization using Remotion, replacing the Playwright recordVideo + FFmpeg pipeline.
**Tech Stack**: TypeScript, React, Remotion, FFmpeg, Next.js
**Components**: site/scripts/export-videos.ts, site/src/app/demos/export/[scenario]/ExportShell.tsx, site/src/components/docs/demos/engine/VideoExportContext.tsx, site/src/components/docs/demos/scenarios/registry.ts

## Current Status

**Created**: 2026-04-03
**Last Session**: 2026-04-04
**Current Task**: T01 — Replace Playwright Video Export with Remotion
**Status**: IN PROGRESS — Phases 1–3 complete, Phase 4 next

## Phase Progress Summary

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Remotion Setup & Hello World | ✅ Complete |
| Phase 2 | Scenario Composition | ✅ Complete |
| Phase 3 | Audio Integration | ✅ Complete |
| Phase 4 | Render Script | ⬜ Next |
| Phase 5 | Cleanup & Validation | ⬜ Pending |

## Session Progress (2026-04-04, Session 2)

### What Was Accomplished

- **TimeSource context**: Created `engine/TimeSource.tsx` — React context providing frame-derived `currentTimeMs` and `stepStartTimesMs` to engine components
- **ScenarioPlayer frame support**: Modified to consume TimeSource for deterministic step progression, bypassing all `setTimeout` effects in Remotion mode
- **DemoVideo composition**: Created `video/compositions/DemoVideo.tsx` — wraps scenario components with TimeSource + VideoExport providers, virtual viewport (960×540 @ zoom 2×), and `<Audio>` sequences
- **Timeline library**: Created `video/lib/timeline.ts` — pure function computing step frame offsets and audio clip positions from steps + manifest
- **All 10 scenarios registered**: Updated `video/Root.tsx` with all scenario compositions and pre-computed timelines
- **Video sizing**: Iterated on component sizing — settled on 91% vertical fill with `DEMO_VIDEO_SHELL_HEIGHT = 460px` and CSS variable override in AppShell
- **Cursor fix**: Made `Cursor.tsx` TimeSource-aware with CSS zoom compensation for `getBoundingClientRect()` position calculations
- **ESM resolution**: Added webpack `fullySpecified: false` rule in `remotion.config.ts` for `@stigmer/theme` extensionless imports
- **All 10 videos rendered**: Successfully generated MP4s for all scenarios at `site/dist/videos/`

### Key Decisions Made

1. **TimeSource as context, not prop**: Engine components detect Remotion mode via context presence rather than props, avoiding prop-drilling through scenario components
2. **Virtual viewport with CSS zoom**: 960×540 at zoom 2× preserves CSS layout while producing crisp 1920×1080 output
3. **91% fill, not 100%**: User reviewed both options and preferred the subtle dark framing over edge-to-edge fill
4. **Zoom compensation formula**: `(eRect - cRect) / (cRect.width / container.offsetWidth)` — robust to any zoom factor

### Files Modified/Created

**New files:**
- `site/src/components/docs/demos/engine/TimeSource.tsx`
- `site/video/compositions/DemoVideo.tsx`
- `site/video/lib/timeline.ts` (committed in Phase 1)

**Modified files:**
- `site/remotion.config.ts` — ESM resolution rule
- `site/src/components/docs/demos/engine/Cursor.tsx` — TimeSource-aware positioning
- `site/src/components/docs/demos/engine/ScenarioPlayer.tsx` — frame-driven step derivation
- `site/src/components/docs/demos/shared/tokens.ts` — `DEMO_VIDEO_SHELL_HEIGHT`
- `site/src/components/docs/demos/views/AppShell.tsx` — CSS variable for shell height
- `site/video/Root.tsx` — all 10 scenario compositions

## Next Steps

1. **Phase 4: Render Script** — Create `site/scripts/render-videos.ts` using `@remotion/renderer` programmatic API
   - Single scenario rendering: `render-video SCENARIO=quickstart-playback`
   - Batch rendering: `render-videos` (all scenarios)
   - Add Makefile targets
   - Output to `dist/videos/` (already gitignored)

2. **Phase 5: Cleanup & Validation**
   - Remove Playwright video recording code from `export-videos.ts`
   - Remove `serve` startup/shutdown from export pipeline
   - Remove Playwright devDependency if no longer used
   - Side-by-side quality comparison of old vs new output
   - Update `package.json` scripts and `Makefile`

## Context for Resume

- The `computeTimeline()` function in `video/lib/timeline.ts` is the bridge between narration manifests and Remotion frames — it pre-computes everything needed for deterministic rendering
- ScenarioPlayer is fully backwards-compatible: when no TimeSource is present (live site), all behavior is unchanged
- Cursor zoom compensation uses `cRect.width / container.offsetWidth` — this ratio equals the effective CSS zoom and works for any value, not just 2×
- Videos are rendered to `site/dist/videos/` which is gitignored
- The `site/video/lib/timeline.ts` was committed as part of Phase 1

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

## Quick Commands

After loading context:
- "Continue with Phase 4" — Start the render script
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress
- "Review guidelines" — Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
