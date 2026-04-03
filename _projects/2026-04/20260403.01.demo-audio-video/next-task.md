# Next Task: 20260403.01.demo-audio-video

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260403.01.demo-audio-video

**Description**: Add AI-generated audio narration to demo scenarios and build a video export pipeline for social media content. Extend the ScenarioPlayer engine with audio sync, use Edge TTS for free narration generation, and use Playwright + FFmpeg to export MP4 videos for LinkedIn and YouTube.
**Goal**: Extend the demo engine so each scenario produces both interactive website demos with narrated audio and exportable MP4 videos for LinkedIn/YouTube. One set of step definitions (AI-written by the document writer) produces both outputs.
**Tech Stack**: TypeScript, React 19, Next.js 15, Edge TTS, Playwright, FFmpeg, Framer Motion
**Components**: site/src/components/docs/demos/engine/ScenarioPlayer.tsx, site/src/components/docs/demos/scenarios/*, site/src/components/docs/demos/engine/shared.ts, site/scripts/, site/Makefile, _roles/002_document_writer.md

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.01.demo-audio-video/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.01.demo-audio-video/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.01.demo-audio-video/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.01.demo-audio-video/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.01.demo-audio-video/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.01.demo-audio-video/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.01.demo-audio-video/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.01.demo-audio-video/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.01.demo-audio-video/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.01.demo-audio-video/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.01.demo-audio-video/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.01.demo-audio-video/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.01.demo-audio-video/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-04-03 14:45
**Current Task**: T01 — All phases complete (1–6). Project complete.
**Status**: Complete

## Session Progress (2026-04-03, Session 1 — Phase 1)

- Phase 1 (ScenarioPlayer audio engine) fully implemented and verified
- Created `engine/narration.ts` with `NarrationEntry` and `NarrationManifest` type definitions
- Created `engine/useNarrationPlayback.ts` custom hook (audio element management, mute toggle, step-synced playback, autoplay policy handling)
- Extended `ScenarioStep<T>` with optional `narration` field for TTS text
- Extended `ScenarioPlayerProps<T>` with optional `narrationManifest` prop
- Added mute/unmute toggle button (VolumeX/Volume2 from lucide-react) to ScenarioPlayer controls
- Hidden `<audio>` element rendered only when manifest is provided

### Key Design Decision (Phase 1)
- Used a separate `narrationManifest` prop on ScenarioPlayer instead of `narrationSrc` on `ScenarioStep<T>`. This cleanly separates authored content (narration text on steps) from build artifacts (audio URLs in manifest).

## Session Progress (2026-04-03, Session 2 — Phase 2)

- Phase 2 (TTS build script) fully implemented and verified
- Installed `edge-tts-universal` (v1.4.0) as devDependency — TypeScript-native, zero deps
- Created `site/scripts/generate-narration.ts`: scenario discovery, hash-based caching, Edge TTS synthesis via `en-US-AndrewMultilingualNeural` voice, manifest generation
- Added `generate-narration` script to package.json, Makefile target, and .gitignore for `public/demos/`
- Validated dynamic import of step files with protobuf and `@stigmer/react/demo` deps works in `tsx`
- Smoke-tested: dry-run (0 narration), generation (1 test clip at 4.3s/28KB), caching (second run skips TTS)
- Audio duration computed from Edge TTS word-boundary metadata (100ns units)
- Build-time cache stored in `.narration-cache.json` separate from runtime `manifest.json`

## Session Progress (2026-04-03, Session 3 — Phases 3 & 6)

- Phase 3 (narration content) fully implemented — all 10 playback scenarios have narration text
- Phase 6 (document writer role update) completed — narration authoring guidelines added to `_roles/002_document_writer.md`
- 30 narrated steps out of 75 total (~40% density), each 1–2 sentences
- Narration written in 4 batches with review after each: Quickstart path, Creation tours, MCP features, Concept demos
- TypeScript: zero errors. ESLint: zero warnings.

### Narration philosophy established
- Narrate concepts and outcomes, not screen mechanics
- Silent steps are deliberate — navigation, scrolling, cursor clicks are visual pauses
- Register matches the page context (quickstart = simplest, concepts = more precise)
- Each tour emphasizes different concepts despite identical UI structure

## Session Progress (2026-04-03, Session 4 — Phase 4)

- Phase 4 (dynamic step timing + manifest wiring) fully implemented and verified
- Ran `make generate-narration` — produced 33 MP3 audio files and 10 manifest.json files across all playback scenarios
- Created `engine/useNarrationManifest.ts` — runtime fetch hook that loads `/demos/{scenarioId}/manifest.json`, returns `NarrationManifest | undefined`, gracefully handles 404
- Modified ScenarioPlayer auto-advance `useEffect` to compute `effectiveDelay = Math.max(baseDelay, narrationDuration)` when unmuted; added `muted` and `narrationManifest` to the dependency array so timer recalculates on mid-step mute toggles
- Wired `useNarrationManifest` hook into all 10 playback scenario `index.tsx` files (import, hook call, prop)
- TypeScript: zero errors. ESLint: zero new warnings.

### Discovery and resolution
- Manifest wiring was a gap from Phase 1 — the `narrationManifest` prop existed on ScenarioPlayer but no scenario loaded or passed a manifest. Addressed as part of Phase 4 since the timing logic depends on the manifest being available, and audio playback was otherwise completely dormant.

### Key design decisions (Phase 4)
- **Runtime fetch over static import**: Manifests are fetched via `fetch()` at runtime from `/demos/{id}/manifest.json` (static assets in `public/`). This works with `output: "export"`, gracefully degrades when narration hasn't been generated, and avoids coupling component code to build artifacts.
- **No race condition by design**: The mute toggle only renders when `narrationManifest` is truthy, so the user cannot unmute before the manifest arrives.
- **Timer reset on mute toggle**: Adding `muted` to the dependency array means the timer resets from scratch when muted changes. This naturally syncs with the narration hook, which also restarts/stops the clip on mute toggles.
- **No hard cap on duration**: If a narrated step feels too long, the fix is shorter narration text, not a code-level cap that cuts audio mid-sentence.

## Session Progress (2026-04-03, Session 5 — Last-Step Narration Bugfix)

- Fixed a timing bug where every scenario's final step narration was immediately paused after starting
- Root cause: the auto-advance timer effect in `ScenarioPlayer.tsx` called `setPlaying(false)` synchronously when `stepIndex >= lastIndex`, triggering the narration playback hook to call `audio.pause()` in the next render cycle
- Fix: in the `stepIndex >= lastIndex` branch, defer `setPlaying(false)` by the final step's `narrationDuration` when unmuted; immediate stop when muted or no narration (preserves existing behavior)
- All 10 scenarios benefit — every one has narration on its last step
- Single file changed: `ScenarioPlayer.tsx`. Zero new types, zero dependency changes.

### Key insight (Session 5)
- The `durationMs`-based timing for non-final steps was already correct. The gap was only in the final-step branch, which had no timer at all — it treated reaching the last step as "done" without considering that a narration clip might still need to play.

## Session Progress (2026-04-03, Session 6 — Phase 5: Video Export Pipeline)

- Built the complete video export pipeline: Playwright recording + FFmpeg audio compositing
- Created `VideoExportContext.tsx` — React context providing `isVideoExport`, `hideControls`, `initialMuted`
- Created `scenarios/registry.ts` — programmatic map of scenario IDs to React components
- Created export route at `site/src/app/demos/export/[scenario]/` with `ExportShell.tsx`, layout with noindex, and `generateStaticParams`
- Created `site/scripts/export-videos.ts` — full pipeline: prerequisite checks, static server, Playwright recording, FFmpeg compositing, timeout computation, batch/single export
- Updated `ScenarioPlayer.tsx`: video export auto-play bypass (IntersectionObserver unreliable in headless), `data-playback-complete` attribute, timeline logging to `window.__exportTimeline`
- Updated `useNarrationPlayback.ts`: `initialMuted` option (false for export, true for website)
- Updated `robots.ts`, `.gitignore`, `Makefile`, `package.json` for export pipeline integration
- Smoke test passed: `approval-flow-playback` exported as 1920x960 H.264 MP4 with 2 AAC audio clips

### Bugs fixed during smoke test
1. **`serve -s` flag** caused all routes to fall back to `index.html`. Removed `-s` since `serve` supports clean URLs by default.
2. **IntersectionObserver in headless Chromium** didn't reliably trigger auto-play. Added direct `setPlaying(true)` bypass for video export mode.
3. **Scenario discovery assumed subdirectories** but Next.js static export produces `.html` files. Fixed to handle both formats.

### Discovery: Node 23 incompatibility
`next build` silently fails to produce the `out/` directory on Node 23.1.0 (exits 0 but never enters static generation). Works correctly on Node 22.22.1. The `engines` field already excludes Node 23 but doesn't enforce it.

### Video quality limitation (known)
Playwright's VP8 video recording produces dim, low-contrast output on dark UIs. Screenshots from the same Playwright instance are pixel-perfect, confirming the issue is in the VP8 codec. Follow-up project `20260403.02.remotion-video-export` created to replace Playwright with Remotion for pixel-perfect video rendering.

## Session Progress (2026-04-03, Session 7 — Narration Audio Cutting Fix)

- Fixed audio clipping during step transitions — narration tail was being cut by ~50-200ms at every step advance
- Root cause: `setTimeout` and `playClip()` fire in the same React effect flush, but audio needs load/decode time before becoming audible; additionally Edge TTS `durationMs` metadata undercounts actual MP3 duration
- Added `NARRATION_SAFETY_BUFFER_MS = 250` constant to `ScenarioPlayer.tsx`, applied to both final-step and non-final-step branches of the auto-advance effect (only when narration is active)
- Added `prefetchManifestClips()` to `useNarrationPlayback.ts` — pre-fetches all clip URLs into browser HTTP cache on unmute (interactive) or at mount (video export), eliminating network latency at transitions
- Two files changed, zero new files, zero lint/type errors
- Manual browser testing blocked by unrelated MDX build error in `docs/sdk/agent-execution.mdx`

### Design decision (Session 7)
- **Buffer-based over event-driven timing**: A 250ms buffer is simpler and sufficient for small same-origin MP3 files. Event-driven approach (listen for `playing` event, defer timer) was evaluated and rejected — it couples the audio hook to step orchestration and adds async complexity to effect cleanup. Can be revisited if 250ms proves insufficient.

## Project Completion

All 6 phases are complete:
- Phase 1: ScenarioPlayer audio engine
- Phase 2: TTS build script (Edge TTS)
- Phase 3: Narration content for all 10 scenarios
- Phase 4: Dynamic step timing + manifest wiring
- Phase 5: Video export pipeline (Playwright + FFmpeg)
- Phase 6: Document writer role update

**Follow-up**: Video quality improvement tracked in `20260403.02.remotion-video-export`

---

*This file provides direct paths to all project resources for quick context loading.*
