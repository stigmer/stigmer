# Phase 2: Sales Website Content Implementation

**Date**: March 31, 2026

## Summary

Implemented the complete sales website content for stigmer.ai, transforming the existing placeholder site into a conversion-oriented marketing experience. The work spans a full Figma-aligned theme overhaul (monochromatic palette, new typography), 8 purpose-built homepage sections sourcing content from Phase 1 strategy deliverables, 2 supporting pages, and docs landing page alignment — all passing build and TypeScript compilation with zero errors.

## Problem Statement

The stigmer.ai sales website had placeholder content with a generic blue/purple color scheme, glassmorphism effects, and lorem-ipsum-grade section structure. It didn't communicate Stigmer's positioning, differentiation, or value proposition. Phase 1 produced comprehensive strategy deliverables (positioning, vocabulary guide, demo story, use cases, information architecture) but none of that content had been applied to the actual website.

### Pain Points

- Homepage sections (Features, Architecture) contained placeholder text that didn't reflect Stigmer's actual capabilities or positioning
- Visual design (gradients, glow effects, glass cards) didn't match the designer's Figma direction
- Navigation and footer didn't match the information architecture's defined site map
- No use-cases page, pricing page, or proper docs landing page existed
- CTAs pointed nowhere meaningful
- Typography (Geist/Geist Mono) didn't match the brand direction

## Solution

Executed a phased implementation plan (2A through 2F) that systematically replaced every layer of the sales website — from CSS tokens up through page-level content — using Phase 1 deliverables as the single source of truth for all copy and the Figma design file as the single source of truth for visual treatment.

## Implementation Details

### Theme Foundation (Phase 2A)
- **Fonts**: Replaced Geist/Geist Mono with Instrument Sans (display/body), Instrument Serif (italic accent), DM Mono (labels/code) — extracted from Figma via MCP tools
- **Colors**: Monochromatic HSL palette: `#0a0a0a` background, `#f5f5f5` headings, `#a3a3a3` body, `#505050` labels. Custom `--color-subtle` token added to Tailwind theme.
- **Aesthetics**: Removed all `glass-*`, `glow-*` CSS utilities and component variants. Flat borders, 1px separators, no shadows.
- **Dark mode**: Marketing pages forced dark via `className="dark"` on `<html>`; docs retain Fumadocs light/dark toggle via RootProvider override.

### Layout Shell (Phase 2B)
- **Navigation**: Use Cases, Docs, Pricing, GitHub, Sign In, Start Free — per IA Section 3
- **Footer**: 3-column (Product, Developers, Open Source) with DM Mono uppercase headings and Apache 2.0 badge
- **Header**: Semi-transparent dark backdrop (`rgba(10,10,10,0.88)`), monochromatic link styling

### Homepage Sections (Phase 2C)
8 sections implemented in IA-defined order:
1. **Hero**: Headline A from positioning, trust badges, code preview window, stats bar, radial gradient background
2. **Demo Story** (NEW): Three-act e-commerce narrative condensed from `demo-story.md`, numbered 01/02/03 pattern
3. **Capabilities**: Three pillars (Knows Your Business, Uses Your Tools, Asks Before Acting) from positioning
4. **How It Works**: Teach/Connect/Deploy numbered steps
5. **What You Can Build**: 5 use case cards (Healthcare, HR, FinTech, Education, Legal) from `use-cases.md`
6. **Why It Works**: 4 foundation points synthesized from positioning Foundation pillar
7. **Open Source**: Apache 2.0 emphasis with self-host and inspect-every-decision signals
8. **Final CTA**: Start Free + tabbed SDK install snippets (TypeScript/Go/Python)

### Supporting Pages (Phase 2D)
- **/use-cases**: Expanded 5-industry stories with builder persona, challenge, capabilities, proof interaction, and outcome
- **/pricing**: Placeholder with Free/Pro/Enterprise tiers

### Docs Alignment (Phase 2E)
- Updated `docs/index.mdx` with 4 routing cards per IA (Getting Started, Core Concepts, Tutorials, SDK Reference)
- Added `Cards`/`Card` to MDX component exports
- Fonts applied globally — docs use same Instrument Sans as sales site

### Validation (Phase 2F)
- CTA audit: 20+ CTAs mapped against IA Section 4; fallbacks → `/docs` with TODO comments
- Vocabulary compliance: sales copy verified against `docs/vocabulary.md` context rules
- Build: `yarn build` and `tsc --noEmit` both pass
- Dead code cleanup: removed 4 unused components (Architecture.tsx, Features.tsx, Quickstart.tsx, StigmerLogo.tsx)

## Benefits

- **Positioning coherence**: Every headline, sub-headline, and section pulls from the approved positioning document — no ad-hoc copy
- **Figma fidelity**: Visual treatment matches the designer's intent without importing content or extra sections
- **Build health**: Zero TypeScript errors, zero build warnings, clean component tree
- **CTA traceability**: Every CTA has a TODO comment documenting its intended target for when later phases deliver content
- **Font unification**: Single type system across sales and docs reduces cognitive load
- **Component simplification**: Removed 6 unnecessary component variants and 4 dead component files

## Impact

- **Users visiting stigmer.ai** will see a cohesive, conversion-oriented homepage that clearly communicates what Stigmer is, how it works, and why it matters
- **Future phases (3-7)** have clear handoff points — TODO comments in CTAs mark exactly which links need updating as docs pages are built
- **Design system** is now simplified and monochromatic, making future component development faster and more consistent
- **Docs readers** see a properly structured landing page with clear routing to future content sections

## Related Work

- **Phase 1 deliverables** (Sessions 1-7): Positioning, vocabulary guide, demo story, use cases, information architecture — all serve as content sources for this phase
- **Figma design**: Used via MCP tools for theme extraction (colors, fonts, visual style) only
- **Pre-Phase 2 fixes** (Session 7): README tagline correction, YAML shorthand removal, approval framing rewrite

---

**Status**: Production Ready
**Timeline**: 1 session (Phase 2A through 2F)
**Files Changed**: 20 modified, 11 new, 4 deleted (31 files total)
**Net Lines**: +449 added, -1,746 removed
