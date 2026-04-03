# Video Export Pipeline for Demo Scenarios

**Date**: April 3, 2026

## Summary

Built an end-to-end video export pipeline that records interactive demo scenarios as MP4 videos with narrated audio. The pipeline uses Playwright to capture browser-rendered demos and FFmpeg to composite TTS-generated narration audio at precise step-aligned timestamps. This completes the demo-audio-video project (all 6 phases), enabling one set of step definitions to produce both interactive website demos and exportable social media videos.

## Problem Statement

The platform's demo scenarios are interactive React components designed for the documentation site. There was no way to produce standalone video files from these demos for distribution on LinkedIn, YouTube, or other channels.

### Pain Points

- Demo content locked inside the website — no shareable video format
- Manual screen recording would be error-prone and inconsistent
- No mechanism to synchronize narration audio with step transitions in an exported video
- Need to support batch export of all 10 playback scenarios

## Solution

A three-layer architecture that extends the existing ScenarioPlayer engine without modifying any scenario components:

1. **Engine layer**: `VideoExportContext` provides export-specific settings (auto-play, hide controls, unmuted narration); ScenarioPlayer logs step timestamps to `window.__exportTimeline` for precise audio alignment
2. **Route layer**: Static export pages at `/demos/export/[scenario]` render each scenario full-viewport with a minimal shell, excluded from search engines via `robots.txt` and `noindex` meta
3. **Script layer**: `export-videos.ts` orchestrates the pipeline — serves the static build, launches Playwright to record each scenario, reads the measured timeline, and uses FFmpeg to composite narration audio at the correct offsets

## Implementation Details

### New Files

| File | Purpose |
|---|---|
| `site/src/components/docs/demos/engine/VideoExportContext.tsx` | React context: `isVideoExport`, `hideControls`, `initialMuted` |
| `site/src/components/docs/demos/scenarios/registry.ts` | Maps scenario IDs to React components for dynamic rendering |
| `site/src/app/demos/export/[scenario]/ExportShell.tsx` | Full-viewport wrapper with dark background and watermark |
| `site/src/app/demos/export/[scenario]/page.tsx` | Dynamic route with `generateStaticParams` for static export |
| `site/src/app/demos/export/[scenario]/layout.tsx` | Minimal layout with `noindex` robots directive |
| `site/scripts/export-videos.ts` | Pipeline: serve → record → composite → output |

### Modified Files

| File | Change |
|---|---|
| `ScenarioPlayer.tsx` | Video export auto-play bypass, `data-playback-complete` attribute, timeline logging, final-step narration timing fix |
| `useNarrationPlayback.ts` | `initialMuted` option (false for export, true for website) |
| `robots.ts` | Added `/demos/export/` to disallow list |
| `.gitignore` | Added `dist/videos/` and `.video-tmp/` |
| `Makefile` | Added `export-videos`, `export-video`, `install-playwright` targets |
| `package.json` | Added `playwright` devDependency and `export-videos` script |

### FFmpeg Compositing

The pipeline uses a measured timeline approach: during Playwright recording, ScenarioPlayer logs `{ step, timestamp }` entries to `window.__exportTimeline`. After recording, the script reads this timeline and positions each narration audio clip at its measured offset using FFmpeg's `adelay` filter, then mixes all clips with the video's silent audio track.

### Retina Recording Strategy

Playwright records at 960x480 CSS pixels with `deviceScaleFactor: 2`, producing a native 1920x960 video. This ensures crisp text rendering without scaling artifacts that would occur from recording at 1920x960 CSS and having the browser scale everything up.

## Benefits

- **One-command export**: `make export-videos` or `make export-video SCENARIO=...`
- **Deterministic output**: Same scenario always produces the same video (given same narration audio)
- **Audio sync**: Narration plays at the exact frame where each step transitions
- **Zero component changes**: Existing scenario components are unaware of video export
- **Batch support**: Export all 10 scenarios in one run
- **SEO-safe**: Export pages excluded from search engines and sitemaps

## Impact

- **Content team**: Can produce video assets for social media directly from the demo definitions
- **Marketing**: Consistent, high-quality demo videos for LinkedIn/YouTube
- **Engineering**: Foundation for programmatic video generation — the Remotion follow-up project will improve output quality further

## Related Work

- Predecessor phases in `20260403.01.demo-audio-video`: narration engine (Phase 1), TTS build script (Phase 2), narration content (Phase 3), dynamic timing (Phase 4), document writer role (Phase 6)
- Follow-up project `20260403.02.remotion-video-export`: replaces Playwright VP8 recording with Remotion for pixel-perfect video quality
- Changelog: `2026-04-03-170506-fix-last-step-narration-cutoff.md` (Session 5 bugfix)

---

**Status**: ✅ Production Ready (with known VP8 quality limitation — Remotion migration planned)
**Timeline**: Single day (6 sessions)
