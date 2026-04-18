# Scenar Remotion Video Pipeline and Narration Co-location

**Date**: April 18, 2026

## Summary

Extracted Stigmer's Remotion video rendering pipeline into a standalone `@scenar/remotion` package and co-located narration audio with scenario source files. The Stigmer-specific video code (~820 LOC) has been removed in favor of the generic `@scenar/remotion` package and `scenar render` CLI command. Each scenario directory is now self-contained: steps, component, and narration in one place.

## Problem Statement

The demo video generation pipeline was tightly coupled to Stigmer's codebase, and narration audio was scattered across a separate directory tree from the scenario definitions.

### Pain Points

- **Split narration**: Scenario definitions in `src/components/docs/demos/scenarios/<id>/` but narration audio in `public/demos/<id>/` -- two separate trees coupled by a string convention
- **Non-portable video pipeline**: Stigmer's `video/` directory contained a full Remotion setup (Root, compositions, webpack, timeline) that no other Scenar consumer could reuse
- **Product-specific code in engine path**: The scenario registry, virtual viewport, and DemoVideo composition mixed generic rendering logic with Stigmer's UI concerns (Tailwind, AppShell, watermark)
- **6 heavy devDependencies**: `remotion`, `@remotion/bundler`, `@remotion/cli`, `@remotion/renderer`, `@remotion/tailwind-v4`, `tsconfig-paths-webpack-plugin` all in Stigmer's site package.json

## Solution

Three-part extraction: (A) add `ScenarioBundle<T>` and bundle support to the Scenar engine, (B) create `@scenar/remotion` package ported from Stigmer's tested implementation, (C) co-locate narration and remove Stigmer's Remotion pipeline.

## Implementation Details

### Scenar Engine Changes (scenar-ai/scenar)

**`@scenar/core` -- ScenarioBundle<T>**: A typed value grouping `id`, `steps`, and `narrationManifest` into one object. Replaces the ad-hoc pattern of passing these as separate props.

**`@scenar/react` -- ScenarioPlayer bundle prop**: Accepts `bundle?: ScenarioBundle<T>` alongside existing individual props. Backward compatible.

**`@scenar/remotion` (new package)**: Ported from Stigmer's `video/lib/timeline.ts` and `video/compositions/DemoVideo.tsx` with product-specific parts factored out:
- `ScenarioComposition` -- wraps `TimeSourceProvider` + `VideoExportProvider`, places `<Audio>` elements at frame-accurate offsets via `<Sequence>` with bounded `durationInFrames`
- `useScenarioTimeline` / `calculateScenarioTimeline` -- ms-to-frame conversion with `AudioClip[]` and `stepStartFrames[]`
- Audio resolution via Remotion's `staticFile()` (same pattern as Stigmer)
- `Math.round` for all frame conversions (matching Stigmer exactly)

**`@scenar/cli` -- `scenar render` command**: Loads a scenario bundle from a directory, resolves a Remotion entry point, and orchestrates the render pipeline. Output defaults to CWD (video files are build artifacts, not source).

### Stigmer Site Changes (stigmer/stigmer)

**Narration co-location**: Moved 25 narration directories (119 MP3 files + 25 manifests) from `public/demos/<id>/` to `scenarios/<id>/narration/`. Added `copy-narration-to-public.ts` to copy co-located audio to `public/demos/` for Next.js static serving.

**Video pipeline removal**: Deleted `site/video/` (Root.tsx, DemoVideo, HelloWorld, timeline, webpack, styles), `render-videos.ts`, `remotion.config.ts`, and `registry.ts`. Removed 6 Remotion devDependencies.

## Benefits

- **Self-contained scenarios**: `ls scenarios/quickstart-tour/` shows everything -- steps.ts, index.tsx, narration/
- **Reusable video pipeline**: Any Scenar consumer gets video rendering via `@scenar/remotion` + `scenar render`
- **Lighter Stigmer**: 6 fewer devDependencies, ~820 fewer lines of product-specific video code
- **No behavioral regression**: The `@scenar/remotion` implementation was verified against Stigmer's original by comparing `staticFile()` usage, `Math.round` frame conversion, `durationInFrames` on Sequences, and provider nesting order

## Impact

- **Scenar consumers**: Can render MP4 videos from scenarios with `scenar render` or by using `ScenarioComposition` directly
- **Stigmer site**: Narration source of truth moves to co-located path; `public/demos/` becomes a build artifact via copy script
- **New tests**: 177 total across Scenar (was 154) -- 15 new for remotion package and render command

## Related Work

- T03: Engine extraction (established `@scenar/core` and `@scenar/react`)
- T05: SDK `createScenario()` (established `@scenar/sdk`)
- Sub-project: Proto simplification + CLI scaffolding (established `scenar` CLI with validate/narrate)

---

**Status**: Production Ready
**Timeline**: Single session
