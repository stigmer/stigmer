# Docs Home Page with SDK Language Icons

**Date**: March 21, 2026

## Summary

Built the documentation landing page at `/docs` with platform-builder-focused hero copy, a colorful SDK language icon row (Go, Java, Python, React, TypeScript), and six section navigation cards. This completes Phase 2 of the docs content migration, giving the documentation site a polished entry point that matches the quality bar of production documentation sites like docs.temporal.io.

## Problem Statement

After the Phase 1 clean slate (deleting ~119 stale files), the docs landing page was a three-line placeholder: "Documentation is being rebuilt. Check back soon." Platform builders arriving at `/docs` had no orientation, no sense of what SDKs are supported, and no navigation path into the documentation sections.

### Pain Points

- No visual indication of supported languages/SDKs
- No navigation cards pointing to documentation sections
- Placeholder copy conveyed "nothing here yet" rather than "here's what's coming"
- No hero copy establishing the docs' purpose for platform builders

## Solution

Created a three-section docs home page within the existing Fumadocs layout:

1. **Hero**: "Stigmer Documentation" heading with a platform-builder-focused tagline
2. **SDK Icons**: Five colorful inline SVG icons (Go, Java, Python, React, TypeScript) in official brand colors
3. **Section Cards**: Six Fumadocs Card components pointing to Quickstarts, Concepts, Guides, CLI Reference, SDK Guides, and Architecture — all in "Coming soon." state until content is added in later phases

## Implementation Details

**New component** — `site/src/components/mdx/language-icons.tsx`:
- Server component (zero client JS) rendering five inline SVG icons
- Each icon uses the language's official brand color
- Responsive flex layout that wraps on narrow viewports
- Registered in the MDX component mapping alongside Card, Cards, and Mermaid

**Icon designs**:
- Go: Teal (#00ADD8) rounded square with "Go" text
- Java: Orange (#E76F00) coffee cup with steam and handle
- Python: Blue (#3776AB) and gold (#FFD43B) interlocking shapes
- React: Cyan (#61DAFB) atom orbital (3 ellipses + center dot)
- TypeScript: Blue (#3178C6) rounded square with "TS" text

**Content** — `docs/index.mdx`:
- Hero copy: "Everything you need to build, deploy, and manage AI agents in your platform."
- Six section cards using Fumadocs `<Cards>` and `<Card>` components
- Cards omit `href` to avoid 404s until section content exists

**Sidebar** — `docs/meta.json`:
- Title changed from "Docs" to "Home"

## Benefits

- Platform builders now see a polished entry point instead of a placeholder
- SDK language support is immediately visible — Go, Java, Python, React, TypeScript
- Section cards provide a mental map of the documentation structure even before content exists
- Zero new npm dependencies — all icons are inline SVGs
- Zero client-side JavaScript for the icons (server component)

## Impact

- **Docs site visitors** see a professional, organized landing page
- **Future phases** (concepts, quickstarts) have clear card targets to link to
- **Build verified**: `yarn build` passes cleanly with the new page

## Related Work

- Phase 0: Audience & Purpose foundation (reminder 007, Diataxis framework)
- Phase 1: Clean Slate + Visual Foundation (typography, Mermaid, stale file deletion)
- Phase 3 (next): Top 5 Concepts from protos

---

**Status**: ✅ Production Ready
**Timeline**: Single session
