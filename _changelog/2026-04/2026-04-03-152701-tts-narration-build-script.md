# TTS Narration Build Script (Edge TTS)

**Date**: April 3, 2026

## Summary

Added a build-time script that generates MP3 narration audio from scenario step definitions using Microsoft Edge TTS. This is Phase 2 of the demo audio/video project — it produces the build-time artifacts that Phase 1's ScenarioPlayer audio engine consumes at runtime.

## Problem Statement

Phase 1 added audio playback capabilities to `ScenarioPlayer`, but there was no way to produce the audio files or manifests it needs. Each demo scenario can have narration text on its step definitions, but without a build pipeline, that text just sits unused.

### Pain Points

- No tooling to convert narration text into audio files
- No manifest generation to bridge build-time TTS output and runtime playback
- Manual audio recording would be unsustainable across 10+ scenarios with frequent content changes

## Solution

Created `site/scripts/generate-narration.ts` — a build-time script that scans all scenario step definitions, extracts `narration` text, synthesizes MP3 audio via Edge TTS, and writes per-scenario manifests matching the `NarrationManifest` contract from Phase 1.

## Implementation Details

**Package choice**: `edge-tts-universal` (v1.4.0) — a pure TypeScript conversion of the Python `edge-tts` library. Zero runtime dependencies, works in Node.js via `tsx`. Installed as a devDependency since it's build-time only.

**Script architecture** (`site/scripts/generate-narration.ts`):

1. **Scenario discovery** — scans `scenarios/*/steps.ts` directories, dynamically imports each module via `pathToFileURL`, and duck-types the exported steps array (finds any array export whose elements have `delayMs`).

2. **Hash-based caching** — SHA-256 of `voice + narration text`. Per-scenario `.narration-cache.json` stores hashes and durations. If the hash matches and the MP3 file exists on disk, TTS is skipped. This makes re-runs fast and idempotent.

3. **TTS synthesis** — uses the `EdgeTTS` simple API with `en-US-AndrewMultilingualNeural` voice. Audio duration is computed from word-boundary metadata returned by the service (100-nanosecond offsets), with a bitrate-based fallback.

4. **Manifest generation** — writes `manifest.json` per scenario matching `NarrationManifest`: `{ steps: [{ src, durationMs } | null] }`. The manifest is the contract between build-time (this script) and runtime (ScenarioPlayer).

5. **Error handling** — per-scenario error isolation (one failure doesn't abort others), clean console reporting with cached/generated/skipped counts.

**Build integration**:
- `package.json`: `"generate-narration": "tsx scripts/generate-narration.ts"`
- `Makefile`: `generate-narration` target
- `.gitignore`: `public/demos/` (generated audio and manifests are build artifacts)

**Key technical finding**: `tsx` can dynamically import scenario step files that depend on `@stigmer/protos`, `@stigmer/react/demo`, and `@bufbuild/protobuf` without issues. These are pure data factories (protobuf object creation), not React components, so they resolve correctly outside the Next.js context.

## Benefits

- **Zero manual effort**: narration audio is regenerated automatically from text changes
- **Idempotent**: hash-based caching means unchanged narration is never re-synthesized
- **Free**: Edge TTS requires no API key, no account, no billing
- **Upgradeable**: swapping to ElevenLabs or OpenAI TTS requires changing only the `synthesize()` function — the pipeline, caching, and manifest format stay the same
- **Fast**: cached re-runs complete in ~2 seconds; fresh generation takes ~4-8 seconds per audio clip

## Impact

- Completes the build-time half of the narration pipeline (Phase 2 of 6)
- Unblocks Phase 3 (adding narration text to step definitions) and Phase 4 (dynamic step timing)
- No impact on existing demos — the script produces no output when no narration text exists

## Related Work

- Phase 1 changelog: `2026-04-03-151559-scenario-player-audio-narration-engine.md`
- Project plan: `_projects/2026-04/20260403.01.demo-audio-video/tasks/T01_0_plan.md`

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
