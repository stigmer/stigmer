# Information Architecture — Phase 1 Content Strategy Complete

**Date**: March 31, 2026

## Summary

Completed the Information Architecture document, the fifth and final deliverable of Phase 1 (Content Strategy). This completes the entire strategic foundation for the Stigmer sales site and documentation — five deliverables defining positioning, vocabulary, narrative, use cases, and structural blueprint. Phase 2 (Sales Website Content) can now begin.

## Problem Statement

Phase 1 required a structural blueprint that translates the positioning, vocabulary, demo story, and use case decisions into a concrete page inventory, navigation design, and reader journey map. Without this, Phase 2–7 implementers would make ad-hoc structural choices that fragment the reader experience.

### Pain Points

- The existing `docs/CONTRIBUTING.md` defined a 9-directory structure written for infrastructure engineers — misaligned with the Phase 1 repositioning toward technical founders
- No defined connection between sales site CTAs and specific docs pages — risk of dead-end links
- No progressive learning path design — readers had no clear route from "what is this?" to "I'm running agents in production"
- The document writer role's Diataxis mandate was being misapplied as a sidebar organization scheme rather than a per-page quality standard

## Solution

Created a 771-line Information Architecture document covering six areas: complete site map, sales site navigation, docs sidebar tree, CTA-to-docs mapping, progressive learning paths, and maintenance notes. The document also resolved three structural decisions and identified three corrections needed for the document writer role.

## Implementation Details

### Site Map
- 3 marketing pages: homepage, `/use-cases`, `/pricing`
- 24 documentation pages across 6 directories
- Future expansion slots identified for self-hosting, architecture, and contributing sections

### Docs Directory Structure (revised from 9 to 6)
- `getting-started/` (3 pages) — cloud-first quickstart, self-hosted, first Skill
- `concepts/` (9 pages) — ordered by messaging pillar progression
- `tutorials/` (4 pages, new) — progressive build tutorials from Phase 6
- `sdks/` (4 pages) — TypeScript primary, Go, Python, Java
- `cli/` (overview + auto-generated commands)
- `reference/` (gRPC API)

Removed: `integration/` (absorbed into SDKs/tutorials), `architecture/` (future expansion), `deployment/` (future as "self-hosting"), `contributing/` (stays as repo file)

### Sidebar Design Decision
Journey-then-topic organization with Fumadocs `---Label---` separators. Diataxis stays as a per-page quality rule (every page is exactly one type), not a navigation scheme. This matches industry best practice (Stripe, Vercel, Supabase).

### CTA Mapping
15 homepage CTAs and 5 navigation CTAs mapped to specific target pages with validation rules for launch readiness.

### Progressive Learning Paths
Six named paths from 5-minute quickstart to 70-minute full build, each with next-step prompts connecting pages in sequence.

### Document Writer Role Corrections (3 items, documented for follow-up)
1. Add writing-context awareness (calibrate register per vocabulary guide contexts)
2. Clarify Diataxis scope (per-page quality, not sidebar mandate)
3. Scope infrastructure-analogy prohibition (allowed in architecture/contributor docs)

## Benefits

- Every Phase 2–7 implementer has a single reference for where files go, what they're called, and how they connect
- No CTA can be created without a target page — structural completeness enforced
- Reader journey is designed, not accidental — progressive disclosure built into sidebar ordering
- `meta.json` plans are ready-to-implement — Fumadocs syntax verified against installed version (15.8.5)

## Impact

**Phase 1 is now complete.** Five deliverables form the strategic foundation:

| # | Deliverable | Lines | Purpose |
|---|-------------|-------|---------|
| 1 | Positioning Document | 343 | Messaging strategy and competitive framing |
| 2 | Vocabulary Guide | 702 | Terminology source of truth |
| 3 | Demo Story Narrative | 376 | Before/after transformation arc |
| 4 | Use Case Library | 389 | 5 industries demonstrating platform breadth |
| 5 | Information Architecture | 771 | Structural blueprint for all pages |

**Total Phase 1 output**: 2,581 lines of strategic documentation.

Next: review all deliverables, resolve 6 vocabulary inconsistencies, apply document writer role corrections, then begin Phase 2.

## Related Work

- Positioning document (`design-decisions/positioning.md`) — messaging foundation
- Vocabulary guide (`docs/vocabulary.md`) — terminology source of truth
- Demo story narrative (`design-decisions/demo-story.md`) — narrative framework
- Use case library (`design-decisions/use-cases.md`) — industry breadth
- T01 plan (`tasks/T01_0_plan.md`) — full 8-phase project plan

---

**Status**: Phase 1 Complete — Pending Review
**Timeline**: Sessions 1–6 (single day, March 31 2026)
