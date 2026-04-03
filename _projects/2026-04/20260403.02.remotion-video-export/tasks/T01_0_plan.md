# Task T01: Replace Playwright Video Export with Remotion

**Created**: 2026-04-03
**Status**: PENDING REVIEW
**Type**: Refactoring
**Predecessor**: 20260403.01.demo-audio-video (Phase 5)

> **This plan requires your review before execution**

## Context — Why Remotion

The current pipeline (built in `20260403.01.demo-audio-video`) records demo
scenarios using Playwright's `recordVideo` API, which internally captures a
VP8/WebM stream. That stream is then transcoded to H.264 via FFmpeg and
composited with narration audio.

**The problem**: Playwright's VP8 recording produces dim, low-contrast video —
especially on dark UIs. Text becomes hard to read, and colours lose vibrancy.
Screenshots taken with the same Playwright instance are pixel-perfect, proving
the issue is in the VP8 recording codec, not the rendering.

**Remotion** eliminates VP8 entirely. It renders each frame as a lossless
screenshot and encodes directly to H.264, producing pixel-perfect output. It
also handles audio natively, removing the need for manual FFmpeg compositing.

## What We Keep (from the predecessor project)

These assets are already built and working — the Remotion migration reuses
them as-is:

| Asset | Path | Purpose |
|---|---|---|
| Scenario registry | `site/src/components/docs/demos/scenarios/registry.ts` | Maps scenario IDs → React components |
| Narration manifests | `public/demos/{scenario}/manifest.json` | Audio `src` + `durationMs` per step |
| Narration audio | `public/demos/{scenario}/step-{n}.mp3` | Generated TTS clips |
| VideoExportContext | `site/src/components/docs/demos/engine/VideoExportContext.tsx` | Provides `isVideoExport`, `hideControls`, `initialMuted` |
| ScenarioPlayer export support | `site/src/components/docs/demos/engine/ScenarioPlayer.tsx` | Auto-play on export, `data-playback-complete`, timeline logging |
| Export route + layout | `site/src/app/demos/export/[scenario]/` | Static pages for each scenario |

## What We Replace

| Current | Replacement |
|---|---|
| `site/scripts/export-videos.ts` (Playwright recording + FFmpeg compositing) | Remotion composition + render script |
| `ExportShell.tsx` (full-viewport wrapper for Playwright capture) | Remotion `<Composition>` wrapper with proper framing |
| `serve` static server for Playwright | Not needed — Remotion renders React directly |

## What We Remove (after migration)

- Playwright devDependency (unless used elsewhere)
- `serve` dependency for the export pipeline
- `.video-tmp/` temp directory handling
- Manual FFmpeg audio compositing logic
- The `--scenario` CLI argument parsing (Remotion has its own CLI/API)

## Phased Plan

### Phase 1: Remotion Setup & Hello World

- Install Remotion packages: `remotion`, `@remotion/cli`, `@remotion/renderer`
- Create `site/remotion/` directory for compositions
- Create a minimal test composition that renders a static frame
- Verify `npx remotion render` produces a clean MP4
- Decision point: evaluate Remotion's bundle size impact on the site (it
  should be devDependencies only, not in the production bundle)

### Phase 2: Scenario Composition

- Create a `<DemoVideo>` Remotion composition that:
  - Imports a scenario component from the registry
  - Wraps it in `VideoExportProvider`
  - Frames it on a dark background (similar to ExportShell but with proper
    Remotion sizing)
  - Handles step timing via Remotion's `useCurrentFrame()` / `useVideoConfig()`
- Key design question: how to map the current timer-based step progression
  (`setTimeout` in ScenarioPlayer) to Remotion's frame-based model. Options:
  1. Drive ScenarioPlayer from Remotion frames (requires modifying ScenarioPlayer
     to accept a `currentFrame` prop)
  2. Let ScenarioPlayer auto-play normally within a Remotion `<OffthreadVideo>`
     iframe capture (simpler but may lose frame precision)
  3. Create a Remotion-specific player that replays the same steps/data
     without ScenarioPlayer (most control but duplicates logic)

### Phase 3: Audio Integration

- Map narration manifests to Remotion `<Audio>` components
- Place audio clips at the correct frame offsets based on step timings
- Verify sync matches the step transitions
- Handle scenarios with no narration (silent videos)

### Phase 4: Render Script

- Create `site/scripts/render-videos.ts` (replaces `export-videos.ts`)
- Use `@remotion/renderer` programmatic API (not CLI) for:
  - Rendering single scenarios
  - Rendering all scenarios in batch
  - Configurable output resolution and codec settings
- Add Makefile targets: `render-videos`, `render-video SCENARIO=...`
- Output to `dist/videos/` (same as current, already gitignored)

### Phase 5: Cleanup & Validation

- Remove Playwright video recording code from `export-videos.ts`
- Remove `serve` startup/shutdown from the export pipeline
- Remove Playwright devDependency if no longer used
- Export all 10 scenarios and verify quality
- Compare output with current pipeline (side-by-side quality check)
- Update `package.json` scripts and `Makefile`

## Key Design Decision (needs resolution in Phase 2)

The critical architectural question is **how ScenarioPlayer's timer-based step
progression integrates with Remotion's frame-based rendering model**.

ScenarioPlayer currently uses `setTimeout` to advance steps, which is
non-deterministic in Remotion's rendering (Remotion controls time, not the
browser). The three options listed in Phase 2 have different trade-offs around
code reuse, precision, and complexity.

This decision should be made collaboratively after a spike/prototype in Phase 2,
not upfront.

## Success Criteria

1. All 10 playback scenario videos render with pixel-perfect, crisp text
2. Audio narration is properly synchronized with step transitions
3. Output is 1920x1080 (or configurable) H.264 MP4 with AAC audio
4. No modifications to existing demo scenario components
5. Render time is reasonable (< 2 min per scenario)
6. Playwright dependency is removed from the export pipeline

## Risks

1. **Remotion + Framer Motion**: Framer Motion animations are time-based, not
   frame-based. Remotion may need special handling to capture them correctly.
2. **Step timing determinism**: ScenarioPlayer's `setTimeout`-based timing is
   designed for real-time playback, not frame-precise rendering. May need
   adaptation.
3. **Bundle boundary**: Remotion's rendering happens in its own bundle, separate
   from the Next.js app. Importing shared components (scenarios, registry) across
   this boundary needs care.

## Review Process

**What happens next**:
1. **You review this plan** — consider the phased approach and the Phase 2
   design question
2. **Provide feedback** — especially on the ScenarioPlayer integration strategy
3. **I'll revise the plan** — incorporating your feedback
4. **You approve** — then execution begins
