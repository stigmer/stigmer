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
**Last Session**: 2026-04-04 (Session 3)
**Current Task**: T01 — Replace Playwright Video Export with Remotion
**Status**: IN PROGRESS — Phases 1–4 complete, Phase 5 next

## Phase Progress Summary

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Remotion Setup & Hello World | ✅ Complete |
| Phase 2 | Scenario Composition | ✅ Complete |
| Phase 3 | Audio Integration | ✅ Complete |
| Phase 4 | Render Script | ✅ Complete |
| Phase 5 | Cleanup & Validation | ⬜ Next |

## Session Progress (2026-04-04, Session 3)

### What Was Accomplished

- **Shared webpack override**: Extracted the webpack override from `remotion.config.ts` into `video/webpack.ts` — shared between the Remotion CLI and the programmatic render script, eliminating duplication
- **Programmatic render script**: Created `scripts/render-videos.ts` using `@remotion/bundler` and `@remotion/renderer` API — bundles once, discovers compositions via `getCompositions()`, renders sequentially with progress reporting
- **Makefile targets**: Added `render-videos` (all scenarios) and `render-video SCENARIO=<id>` (single scenario) targets depending only on `deps`, not `build`
- **Smoke tested**: Rendered `tool-calls-playback` in 8.6s — verified H.264 1920×1080 30fps with AAC audio

### Key Decisions Made

1. **`getCompositions()` for discovery**: Uses Remotion's runtime composition discovery instead of importing `PLAYBACK_SCENARIO_IDS` from the registry — avoids pulling React component modules into a Node.js script context
2. **Sequential rendering**: `renderMedia` already parallelizes frame rendering internally; scenario-level parallelism would multiply memory usage without proportional speedup
3. **No quality presets**: CRF 18 is fast enough for iteration and high enough for production; a `--draft` flag can be added later as a one-line change
4. **`deps` only, not `build`**: Remotion bundles its own React app from source — no Next.js static export or `serve` step needed

### Files Modified/Created

**New files:**
- `site/video/webpack.ts` — shared webpack override (Tailwind v4, tsconfig paths, ESM fix)
- `site/scripts/render-videos.ts` — programmatic render script

**Modified files:**
- `site/remotion.config.ts` — simplified to import from `video/webpack.ts`
- `site/package.json` — added `render-videos` script
- `site/Makefile` — added `render-videos` and `render-video` targets

## Next Steps

1. **Phase 5: Cleanup & Validation**
   - Remove Playwright video recording code from `export-videos.ts`
   - Remove `serve` startup/shutdown from export pipeline
   - Remove Playwright devDependency if no longer used elsewhere
   - Remove old `export-videos` / `export-video` Makefile targets
   - Remove `install-playwright` target
   - Remove `.video-tmp` from clean target
   - Side-by-side quality comparison of old vs new output
   - Batch render all 10 scenarios with new script and verify

## Context for Resume

- The render script uses `getCompositions()` to discover scenario IDs from the bundle, filtering out the `HelloWorld` test composition — no hardcoded list
- `video/webpack.ts` is the single source of truth for webpack overrides — both `remotion.config.ts` (CLI) and `render-videos.ts` (programmatic) import from it
- The `computeTimeline()` function in `video/lib/timeline.ts` is the bridge between narration manifests and Remotion frames
- ScenarioPlayer is fully backwards-compatible: when no TimeSource is present (live site), all behavior is unchanged
- Videos are rendered to `site/dist/videos/` which is gitignored
- Encoding: H.264, CRF 18, yuv420p, AAC audio — named constants in the script

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
- "Continue with Phase 5" — Start cleanup and validation
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress
- "Review guidelines" — Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
