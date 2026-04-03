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
**Current Task**: T01 Phase 1 and Phase 2 complete, ready for Phase 3
**Status**: In Progress

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

## Next Steps

1. **Phase 3: Narration content** — Add `narration` text to all 10 playback scenario step definitions. Run `make generate-narration` to produce audio. This is the content authoring phase.
2. **Phase 4: Dynamic step timing** — Sync step duration with narration clip length when unmuted. Logic: `effectiveDelay = Math.max(step.delayMs, manifest.steps[i].durationMs ?? 0)`.
3. **Phase 5: Video export pipeline** — Playwright records scenarios + FFmpeg composites audio into MP4 files.
4. **Phase 6: Document writer role update** — Add narration authoring guidelines to `_roles/002_document_writer.md`.

## Context for Resume

- The `useNarrationPlayback` hook uses a single `<audio>` element via ref, reusing it across steps by changing `src`. Browser autoplay policy is handled by defaulting to muted and catching rejected `play()` promises.
- The hook is inert when no manifest is provided — all existing scenarios work exactly as before.
- `edge-tts-universal` uses the `EdgeTTS` simple API: `new EdgeTTS(text, voice)` -> `synthesize()` -> `{ audio: Blob, subtitle: [...] }`. Duration from `subtitle[last].offset + subtitle[last].duration` (100ns units / 10000 = ms).
- Dynamic import via `tsx` resolves `@stigmer/protos` and `@stigmer/react/demo` correctly. Named exports are under `mod.default` due to CJS/ESM interop — script uses `mod.default ?? mod`.
- The site uses `output: "export"` (static export) — no server routes available at runtime. Phase 5 video export will need a dev server approach.

## Quick Commands

After loading context:
- "Continue with Phase 3" - Start adding narration content
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
