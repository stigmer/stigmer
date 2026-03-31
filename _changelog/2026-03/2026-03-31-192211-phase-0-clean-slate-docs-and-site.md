# Phase 0 Clean Slate: Remove Stale Documentation and Sales Copy

**Date**: March 31, 2026

## Summary

Removed all stale documentation content and infrastructure-engineer-focused sales website copy as the first phase of the content strategy project. This clears the way for rewriting both the documentation and sales site to target platform builders and founders rather than infrastructure engineers. The documentation toolchain (Fumadocs, Vale, MDX components, build pipeline) is fully preserved.

## Problem Statement

The existing documentation and sales website content were written for infrastructure engineers, emphasizing YAML configuration, gRPC APIs, Temporal workflows, and local-first CLI workflows. The platform's primary audience is platform builders and founders who want to add AI agent capabilities to their products. Every page needed to be rewritten from scratch with new positioning, so keeping stale content would only cause confusion.

### Pain Points

- Sales homepage positioned Stigmer as infrastructure tooling ("Build Agents. Skip the Infrastructure")
- Feature cards highlighted sandboxing, Temporal, zero cloud dependency, gRPC — none of which resonate with the target audience
- Documentation had 60+ pages of stubs, placeholders, and infrastructure-focused content that would need complete rewrites
- 116 archived legacy files added dead weight to the repository
- Footer and navigation links pointed to pages that would be deleted or restructured

## Solution

Execute a clean-slate removal of all content while preserving every piece of infrastructure: Fumadocs configuration, Vale linting, MDX components, the build pipeline, CI workflows, and component shells. This leaves a buildable, minimal site ready for the Phase 1 positioning work that will define the new messaging foundation.

## Implementation Details

### Documentation Cleanup (177 files removed)

- Deleted `docs/_archive/` directory (116 legacy files across ADRs, architecture docs, guides, product explainers, SDK docs)
- Deleted all active content across 10 subdirectories: architecture, cli, cli/commands, concepts, contributing, deployment, getting-started, integration, reference, sdks
- Updated `docs/meta.json` to empty pages array
- Rewrote `docs/index.mdx` to minimal landing page
- Updated `docs/README.md` to reflect new state

### Sales Website Cleanup (6 files modified)

- `site/src/lib/constants.ts`: Neutral placeholders for tagline, description; emptied FEATURES array; pruned NAV_LINKS and FOOTER_LINKS of dead references
- `site/src/components/sections/Hero.tsx`: Stripped infrastructure copy (badges, brew install, sandboxing); now reads from SITE_CONFIG
- `site/src/components/sections/Features.tsx`: Added early return when FEATURES is empty
- `site/src/components/sections/Quickstart.tsx`: Replaced CLI-focused steps with minimal placeholder
- `site/src/components/pages/HomePage.tsx`: Removed Architecture section from rendering
- `site/src/components/layout/Footer.tsx`: Removed Resources column, adjusted grid layout

### Preserved Infrastructure

- Fumadocs config (`source.config.ts`, `source.ts`, `remark-mermaid.ts`)
- Vale configuration and style rules (`.vale.ini`, `vale/` tree)
- MDX components (`site/src/components/docs/`, `site/src/components/mdx.tsx`)
- Docs layout and chrome (`docs/layout.tsx`, `docs/[[...slug]]/page.tsx`, `layout.shared.tsx`)
- UI primitives, layout components, CSS/Tailwind config
- CI workflows, Makefile targets, CLI doc generator
- Process docs (`docs/STYLE.md`, `docs/CONTRIBUTING.md`)
- `Architecture.tsx` file kept for Phase 2 reference (not rendered)

## Benefits

- Clean foundation for Phase 1 (positioning and messaging) with no legacy content to work around
- Site builds and deploys cleanly with zero broken links or imports
- Repository is lighter by ~53,000 lines of stale content
- No risk of accidentally shipping infrastructure-engineer-focused copy to the target audience

## Impact

- **Documentation site**: Shows a single minimal landing page with empty sidebar until new content is written
- **Sales homepage**: Shows Hero (neutral tagline + CTAs) and Get Started section only — no stale features or architecture content
- **Build pipeline**: Fully functional; `yarn build` passes with 1 page, 0 sections
- **Content authors**: Can start fresh in Phase 1 without inheriting wrong positioning

## Related Work

- Content strategy project: `_projects/2026-03/20260331.01.content-strategy/`
- Full project plan: `tasks/T01_0_plan.md` (Phases 0-7)
- Next: Phase 1 (Positioning & Messaging Foundation)

---

**Status**: Production Ready
**Scope**: 192 files changed, 39 insertions, 53,795 deletions
