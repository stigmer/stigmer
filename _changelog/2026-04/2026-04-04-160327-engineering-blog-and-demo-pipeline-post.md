# Engineering Blog Infrastructure and First Post: Demo Video Pipeline

**Date**: April 4, 2026

## Summary

Added a public engineering blog to stigmer.ai using Fumadocs' native `defineCollections` support, and published the first post — a deep-dive into the demo video pipeline architecture. The post explains how the same React component tree renders as interactive website demos, audio-narrated walkthroughs, and pixel-perfect Remotion videos, differentiated only by who controls time.

## Problem Statement

A colleague asked how the demo video pipeline works. The answer touches four layers of the codebase (SDK demo transport, ScenarioPlayer engine, TTS narration, Remotion video rendering) tied together by the `TimeSource` abstraction. This architecture is worth sharing publicly — it showcases engineering quality and the "write once, render three ways" pattern that no off-the-shelf library provides.

### Pain Points

- No blog section existed on the Stigmer site — no venue for engineering deep-dives
- The demo pipeline architecture was undocumented and only understood through code
- Explaining the system verbally was difficult without a structured narrative and diagrams

## Solution

Two deliverables:

1. **Blog infrastructure** — Fumadocs blog collection (`defineCollections`) with blog content at `blog/` (repo root), route pages at `site/src/app/blog/`, and "Blog" added to the site navigation.
2. **First blog post** — Narrative-driven technical deep-dive with 4 inline mermaid diagrams, 8 real code snippets from the codebase, and a full end-to-end pipeline diagram.

## Implementation Details

### Blog Infrastructure

- `site/source.config.ts` — Added `blogPosts` collection with `author` and `date` frontmatter schema via `defineCollections`
- `site/src/lib/source.ts` — Added `blog` loader using `createMDXSource` from `fumadocs-mdx/runtime/next` with `baseUrl: "/blog"`
- `site/src/app/blog/layout.tsx` — Blog layout reusing site Header/Footer, no docs sidebar
- `site/src/app/blog/page.tsx` — Blog index with posts sorted by date, showing title, author, date, description
- `site/src/app/blog/[slug]/page.tsx` — Individual post page with inline TOC, back link, author/date metadata, full MDX rendering with Mermaid support
- `site/src/lib/constants.ts` — Added "Blog" to `NAV_LINKS` between "Docs" and "Pricing"

### Blog Post Structure

The post ("Write Once, Render Everywhere") follows the system's evolution through 8 sections:

1. The Problem — why screenshots and separate video pipelines are unsustainable
2. Layer 1: Real Components, Fake Data — SDK `DemoTransport` and fixture system
3. Layer 2: The Step Engine — generic `ScenarioStep<T>` and render prop pattern
4. Layer 3: Audio Narration — Edge TTS build script and manifest-driven playback
5. The Key Insight: Who Controls Time? — the `TimeSource` abstraction (55 lines)
6. Layer 4: Remotion Video Rendering — `DemoVideo` composition and timeline computation
7. What We Tried First — Playwright VP8 degradation and why Remotion replaced it
8. The Full Picture — end-to-end pipeline diagram and stats

## Benefits

- **Brand building** — First engineering blog post signals technical depth to developers, potential hires, and the community
- **Shareable knowledge** — Colleagues and external developers can now understand the pipeline without reading the code
- **Reusable infrastructure** — Blog collection is ready for future posts with zero additional setup
- **Minimal footprint** — Blog adds 4 new files (3 route files + 1 MDX post) and modifies 4 existing files with small, focused changes

## Impact

- **External visibility**: Public blog on stigmer.ai showcasing engineering culture
- **Site navigation**: "Blog" link added to site header, visible on all pages
- **Content infrastructure**: Fumadocs blog collection ready for future posts
- **Architecture documentation**: The demo pipeline is now documented for the team and community

## Related Work

- `2026-04-04-152303-remove-playwright-video-export-pipeline.md` — Remotion migration (Phase 5 cleanup)
- `2026-04-04-145117-remotion-scenario-compositions-and-cursor-fix.md` — Remotion composition setup
- `2026-04-03-173643-video-export-pipeline.md` — Original video export pipeline
- `2026-04-03-151559-scenario-player-audio-narration-engine.md` — ScenarioPlayer narration system

---

**Status**: ✅ Production Ready
**Timeline**: Single session
