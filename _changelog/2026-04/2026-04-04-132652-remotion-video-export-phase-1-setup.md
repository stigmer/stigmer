# Remotion Video Export — Phase 1 Setup

**Date**: April 4, 2026

## Summary

Installed Remotion v4.0.443 into the site project and validated an end-to-end video rendering pipeline that produces pixel-perfect 1920x1080 H.264 MP4 output with Tailwind v4 styling and the Stigmer dark design system. This replaces Phase 1 of the Playwright-to-Remotion migration and establishes the foundation for scenario integration in Phase 2.

## Problem Statement

The existing video export pipeline uses Playwright's `recordVideo` API, which internally captures a VP8/WebM stream. The VP8 codec produces dim, low-contrast video — especially on dark UIs — making text hard to read and colours flat. Screenshots taken with the same Playwright instance are pixel-perfect, confirming the issue is in the VP8 recording codec, not the rendering.

### Pain Points

- VP8 recording degrades video quality on dark-themed UIs
- Manual FFmpeg compositing required for audio synchronization
- Pipeline requires a full static build + `serve` HTTP server + Playwright browser
- No preview UI for iterating on compositions without full render cycles

## Solution

Introduced Remotion as a dev-only video rendering tool alongside the existing Playwright pipeline (which remains untouched until Phase 5). Remotion renders each frame as a lossless screenshot and encodes directly to H.264, producing pixel-perfect output.

## Implementation Details

### Packages Added (all devDependencies)

- `remotion@^4.0.443` — core React hooks (`useCurrentFrame`, `useVideoConfig`)
- `@remotion/cli@^4.0.443` — CLI for `remotion render` and `remotion studio`
- `@remotion/renderer@^4.0.443` — programmatic render API (pre-installed for Phase 4)
- `@remotion/bundler@^4.0.443` — webpack bundling for programmatic API
- `@remotion/tailwind-v4@^4.0.443` — `enableTailwind()` webpack override
- `tsconfig-paths-webpack-plugin@^4.2.0` — syncs `@/*` path alias from `tsconfig.json`

### Files Created

| File | Purpose |
|------|---------|
| `site/remotion.config.ts` | Webpack overrides for Tailwind v4 and TypeScript path aliases |
| `site/video/index.ts` | Remotion entry point — registers root and imports styles |
| `site/video/Root.tsx` | Composition registry |
| `site/video/styles.css` | Tailwind v4 base + SDK design tokens + site dark palette + Google Fonts |
| `site/video/compositions/HelloWorld.tsx` | Validation composition with fade-in animation and frame counter |

### Files Modified

| File | Change |
|------|--------|
| `site/package.json` | Added 6 devDependencies + `remotion:studio` script |
| `site/Makefile` | Added `remotion-studio` and `remotion-hello` targets |

### Architecture Decisions

**Directory naming**: The compositions directory is `site/video/` (not `site/remotion/`). A directory named `remotion/` conflicts with the `remotion` npm package when `tsconfig.json` has `baseUrl: "."` — webpack resolves `import from "remotion"` to the local directory instead of `node_modules`. Using `video/` is both collision-free and more domain-appropriate.

**CSS strategy**: A dedicated `video/styles.css` imports the Tailwind v4 base, SDK design tokens (`@stigmer/theme/tokens.css`, `@stigmer/react/styles.css`), and the site's monochromatic dark palette. This replicates the exact visual design of the site without carrying fumadocs or other docs-only CSS.

**Font strategy**: Google Fonts loaded via `@import url()` in `video/styles.css`. Instrument Sans, Instrument Serif, and DM Mono load at render time from Google's CDN (WOFF2). This avoids adding font packages as dependencies for a dev-only rendering tool.

## Benefits

- **Pixel-perfect video output**: H.264 High profile encoding produces crisp, readable text on dark backgrounds — the exact quality the VP8 pipeline lacked
- **Preview UI**: `make remotion-studio` launches an interactive composition preview for rapid iteration
- **Fast render**: HelloWorld (90 frames / 3 seconds) renders in ~5 seconds
- **Zero production impact**: All Remotion packages are devDependencies; the `video/` directory is outside `src/` and not bundled by Next.js
- **Design system parity**: Remotion compositions render with the same Tailwind v4 tokens, palette, and fonts as the live site

## Impact

- **Site video export pipeline**: Foundation laid for Phases 2–5 (scenario integration, audio, render script, Playwright removal)
- **Dev workflow**: New `make remotion-studio` and `make remotion-hello` targets available

## Related Work

- Predecessor project: `20260403.01.demo-audio-video` (built the Playwright + FFmpeg pipeline)
- Current project: `20260403.02.remotion-video-export` (this is Phase 1 of 5)

---

**Status**: ✅ Production Ready (Phase 1 complete, no existing code modified)
**Timeline**: Single session
