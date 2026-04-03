# Task T01: Demo Audio Narration & Video Export

**Created**: 2026-04-03
**Status**: PENDING REVIEW
**Type**: Feature Development

⚠️ **This plan requires your review before execution**

## Objective

Extend the demo engine so each scenario produces two outputs from a single source:
1. **Website demos** — interactive playback with synced audio narration (muted by default)
2. **Social media videos** — MP4 files at 1920×1080 for LinkedIn and YouTube

The document writer AI writes narration text alongside step definitions. A build script converts text to audio. No manual recording or post-production.

## Architecture

```
steps.ts (narration text + step data + timing)
    │
    ├─► Website: ScenarioPlayer + <audio> sync + mute toggle
    │
    └─► Video export: Playwright records visual → FFmpeg merges audio → MP4
```

### Single source of truth

Each scenario's `steps.ts` already defines `delayMs`, `data`, and `caption`. This project adds one field: `narration` (plain text script for TTS). Everything else — audio generation, website playback, video export — derives from that field.

## Implementation Phases

### Phase 1: ScenarioPlayer audio engine

Extend the `ScenarioPlayer` React component to support audio playback synced to steps.

**Changes to `engine/ScenarioPlayer.tsx`:**
- Add optional `narrationSrc` field to `ScenarioStep<T>` type
- Add a single `<audio>` ref managed by the player
- When a step becomes active: if it has `narrationSrc` and audio is unmuted, play the clip
- When the user pauses: pause the audio
- When the user clicks prev/next or a progress dot: stop current clip, start new step's clip
- Add mute/unmute toggle button (🔇/🔊) next to existing play/pause
- Default to muted — visual demo works exactly as today for scrolling readers
- When muted, `caption` serves as a subtitle (already does)

**Changes to `engine/shared.ts`:**
- Add optional `narration` field to step data conventions (for build script consumption)

**No changes to existing scenario `index.tsx` files** — they use `ScenarioPlayer` as-is. The audio layer is opt-in per step via `narrationSrc`.

### Phase 2: TTS build script (Edge TTS)

Create `site/scripts/generate-narration.ts` — a build-time script that:

1. Imports all scenario step files
2. For each step with a `narration` field:
   - Hashes the narration text (SHA-256)
   - Checks if `public/demos/{scenario}/step-{n}.mp3` exists with matching hash
   - If changed or missing: calls Edge TTS to generate audio
   - Writes the MP3 file + updates a manifest JSON with file path and duration
3. Writes `public/demos/{scenario}/manifest.json` per scenario:
   ```json
   {
     "steps": [
       { "index": 0, "src": "/demos/approval-flow/step-0.mp3", "durationMs": 4200 },
       { "index": 1, "src": null },
       { "index": 2, "src": "/demos/approval-flow/step-2.mp3", "durationMs": 5100 }
     ]
   }
   ```

**Hash-based caching** ensures the script only calls TTS when narration text actually changes. Re-running is fast and idempotent.

**Makefile integration:**
```makefile
generate-narration:
	tsx scripts/generate-narration.ts
```

**Edge TTS voice selection**: `en-US-AndrewMultilingualNeural` (clear, professional, natural). Can be swapped later to ElevenLabs or OpenAI TTS by changing one function.

### Phase 3: Narration content for all scenarios

Add `narration` text to every playback scenario's step definitions. The 8 playback scenarios that need narration:

1. `approval-flow-playback` (5 steps)
2. `quickstart-playback`
3. `generate-policies-playback`
4. `discover-capabilities-playback`
5. `tool-calls-playback`
6. `session-memory-playback`
7. `agent-creation-tour`
8. `skill-creation-tour`
9. `mcp-server-creation-tour`
10. `api-key-setup`

Static detail views (`agent-detail`, `skill-detail`, `mcp-server-detail`) don't need narration — they're single-frame renders, not playback sequences.

Each step's narration follows the document writer's register rules: plain language for introductory content, tutorial voice ("Follow along with me"), one idea per sentence.

### Phase 4: Dynamic step timing

The `ScenarioPlayer` currently uses `delayMs` for step duration. When audio is enabled, the step should last at least as long as the narration clip.

**Logic:**
```
effectiveDelay = Math.max(step.delayMs, manifest.steps[i].durationMs ?? 0)
```

This only applies when audio is unmuted. When muted, the original `delayMs` timing is preserved so the visual-only experience stays snappy.

### Phase 5: Video export pipeline

Create `site/scripts/export-videos.ts` — a build-time script that:

1. Starts a local Next.js dev server (or uses the production build)
2. For each scenario:
   - Launches Playwright with a 1920×1080 viewport
   - Navigates to a dedicated export route (e.g., `/demos/export/{scenario}`)
   - The export route renders the scenario full-screen, auto-plays with audio unmuted
   - Playwright records the viewport as WebM
   - FFmpeg merges the visual WebM + audio track into a final MP4
3. Outputs files to `dist/videos/{scenario}.mp4`

**Export route** (`site/src/app/demos/export/[scenario]/page.tsx`):
- Renders the scenario component full-screen (no site chrome, no nav, no footer)
- Auto-plays immediately
- Audio unmuted
- Includes a Stigmer watermark/logo in the corner
- Optional: intro title card ("Getting Started with Stigmer") and outro card

**Makefile integration:**
```makefile
export-videos:
	tsx scripts/export-videos.ts

export-video:
	tsx scripts/export-videos.ts --scenario=$(SCENARIO)
```

**Platform-specific formats** (future enhancement):
- YouTube: 1920×1080, 16:9, full scenario
- LinkedIn: 1920×1080, 16:9, same video (or trimmed)
- Twitter/X: 1080×1080, 1:1, highlight clip (subset of steps)

For MVP, one format (1920×1080) serves both LinkedIn and YouTube.

### Phase 6: Document writer role update

Update `_roles/002_document_writer.md` to include narration authoring as a core responsibility:

- Every playback step gets a `narration` field
- Narration follows the same vocabulary and register rules as all other docs
- Narration is conversational, tutorial-grade: explain what the viewer sees and why it matters
- Narration timing drives step duration when audio is enabled
- Caption stays short (subtitle); narration is the full spoken script

## Task Execution Order

| Order | Phase | Dependencies | Can parallelize? |
|-------|-------|-------------|-----------------|
| 1 | Phase 1: ScenarioPlayer audio engine | None | No — foundational |
| 2 | Phase 2: TTS build script | None | Yes, parallel with Phase 1 |
| 3 | Phase 3: Narration content | Phase 1 type changes | Yes, parallel with Phase 2 |
| 4 | Phase 4: Dynamic timing | Phase 1 + Phase 2 | No — needs both |
| 5 | Phase 5: Video export pipeline | Phase 2 (needs audio files) | Yes, parallel with Phase 4 |
| 6 | Phase 6: Doc writer role update | Phase 3 (needs pattern established) | Yes, anytime |

## Dependencies to Install

```bash
# In site/
yarn add -D edge-tts          # Free TTS, no API key
yarn add -D playwright         # Headless browser for video recording
# System-level
brew install ffmpeg             # Audio/video compositing
```

## Success Criteria

1. `ScenarioStep` type has an optional `narration` field
2. `ScenarioPlayer` has a mute/unmute toggle and plays audio synced to steps
3. `make generate-narration` produces MP3 files from narration text via Edge TTS
4. All 10 playback scenarios have narration text in their step definitions
5. `make export-videos` produces 1920×1080 MP4 files ready for LinkedIn/YouTube upload
6. Document writer role includes narration authoring guidelines
7. Existing visual-only demo experience is completely unchanged when audio is muted

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Edge TTS voice quality insufficient | Medium | Upgrade path to ElevenLabs/OpenAI TTS — only the TTS function changes, pipeline stays same |
| Browser autoplay blocks audio | Certain | Mute by default, user opts in with toggle |
| Playwright timing sync issues | Medium | Use fixed delays between steps during recording, not animation-based triggers |
| Large audio files bloat repo | Low | .gitignore generated audio, regenerate in CI |
| Step narration gets stale when steps change | Medium | Hash-based regeneration ensures audio matches current text |

## Review Questions

- Does the 6-phase breakdown make sense, or should anything be reordered?
- Should generated audio files be committed to the repo, or generated in CI and deployed as build artifacts?
- Any preference on the Edge TTS voice (male/female, accent)?
- Should the video export include intro/outro title cards, or just the raw demo?
- Are there scenarios in the list above that should be prioritized for narration first?
