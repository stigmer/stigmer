# Remotion Programmatic Render Script (Phase 4)

**Date**: April 4, 2026

## Summary

Added a programmatic render script that uses `@remotion/bundler` and `@remotion/renderer` to render demo scenario videos. The script bundles the Remotion project once, discovers compositions at runtime, and renders each scenario to H.264 MP4 with AAC audio — replacing the need to invoke `npx remotion render` manually per composition.

## Problem Statement

Phases 1–3 of the Remotion migration established compositions, frame-driven playback, and audio integration. But rendering required manual CLI invocations — one per scenario, with no batch mode, no progress reporting, and no shared webpack configuration between the CLI and the programmatic API.

### Pain Points

- Manual `npx remotion render` per scenario — tedious for 10 scenarios
- `remotion.config.ts` webpack overrides not shared with the programmatic API, requiring duplication
- No Makefile integration for single or batch rendering
- No progress reporting or error summary across a batch run

## Solution

Created a programmatic render script and extracted the webpack override into a shared module, enabling both the Remotion CLI and the script to use identical bundling configuration.

## Implementation Details

### Shared webpack override (`video/webpack.ts`)

Extracted the webpack override (Tailwind v4, tsconfig-paths, ESM fullySpecified fix) from `remotion.config.ts` into a dedicated module. Both `remotion.config.ts` (for the CLI / Remotion Studio) and the render script import from this single source of truth.

### Render script (`scripts/render-videos.ts`)

Uses three Remotion APIs in sequence:

1. `bundle()` — bundles the Remotion project once (cached on subsequent runs)
2. `getCompositions()` — discovers all registered compositions from the bundle, filtering out the `HelloWorld` test composition
3. `renderMedia()` — renders each composition to H.264 MP4 with CRF 18, yuv420p pixel format, and AAC audio

Supports `--scenario=<id>` for single-scenario rendering. Shows per-scenario progress via `onProgress` callback.

### Makefile targets

- `render-videos` — renders all scenarios
- `render-video SCENARIO=<id>` — renders a single scenario

Both depend only on `deps` (node_modules), not `build` — Remotion bundles from source, eliminating the static export + serve step the Playwright pipeline required.

## Benefits

- **One command for all videos**: `make render-videos` renders all 10 scenarios with progress reporting and error summary
- **No duplication**: Webpack override is defined once and shared across CLI and programmatic paths
- **No build step**: Remotion bundles directly from source — faster iteration than the Playwright pipeline that required `make build` first
- **Runtime composition discovery**: Uses `getCompositions()` instead of importing the scenario registry, avoiding React component resolution issues in Node.js

## Impact

- Developers can render videos with a single `make` command
- The render pipeline is now self-contained — no static site build, no `serve`, no Playwright, no FFmpeg compositing
- Phase 5 (cleanup) can now safely remove the old Playwright export code

## Related Work

- [Remotion Scenario Compositions and Cursor Fix](_changelog/2026-04/2026-04-04-145117-remotion-scenario-compositions-and-cursor-fix.md) — Phases 2–3
- [Remotion Video Export Phase 1 Setup](_changelog/2026-04/2026-04-04-132652-remotion-video-export-phase-1-setup.md) — Phase 1
- [Video Export Pipeline](_changelog/2026-04/2026-04-03-173643-video-export-pipeline.md) — Original Playwright pipeline

---

**Status**: ✅ Production Ready
**Timeline**: Single session
