# Sales Website Machine-Readable Standards

**Date**: March 21, 2026

## Summary

Created three JSON files that encode the sales website prose standards into machine-readable formats. These files turn the rules from `website-standards.md` and `information-architecture.md` into structured data consumable by lint tooling, Cursor rules, and CI pipelines — completing Phase 3 of the sales website foundation project.

## Problem Statement

Phases 1-2 established comprehensive standards for the Stigmer sales website in prose form (568-line standards document + 430-line information architecture). While thorough, prose standards cannot be enforced programmatically. Lint scripts cannot grep a markdown table for "max headline words: 8." Cursor rules cannot load a paragraph about banned phrases into a validation check.

### Pain Points

- No machine-readable definition of what each page type must contain
- No structured list of banned copy phrases that a linter can check
- No single source of truth for performance thresholds that CI can validate
- Future phases (lint tooling, Cursor rules) would have to re-extract rules from prose on every invocation

## Solution

Three JSON files that extract every enforceable rule from the Phase 1-2 prose documents into structured, versioned data:

1. **`content-requirements.json`** — Structural requirements for all 9 page types and 8 section types
2. **`copy-guidelines.json`** — Voice rules, banned phrases, required writing patterns, terminology enforcement
3. **`performance-budget.json`** — Core Web Vitals, bundle limits, accessibility thresholds, SEO constraints

## Implementation Details

### content-requirements.json (192 lines)

- **9 page types**: homepage, use-case, comparison, feature, landing, pricing, changelog, blog, community
- **8 section types**: hero, features, how-it-works, code-showcase, comparison, social-proof, cta-band, faq
- **3 personas**: solo-developer, platform-builder, engineering-leader (with motivations and primary objections)
- **Global rules**: min/max internal links per page, no dead-end pages, every section must have a job
- Each page type defines: purpose, funnel stages, personas, required sections, required metadata, linking targets, and success metric
- Each section type defines: job, required elements, and measurable constraints

### copy-guidelines.json (185 lines)

- **7 voice rules**: confident, technical, conversational, second person, present tense, imperative mood, active voice — each with an `enforced_by` field (`"lint"` or `"review"`)
- **16 banned phrases**: Each entry includes `phrase`, `reason`, and `replacement` (not just a flat list)
- **6 required patterns**: every-claim-needs-proof, code-before-paragraph, specific-numbers-over-adjectives, feature-benefit-proof, objection-aware, honest-comparisons
- **6 sales terminology entries**: Sales-context subset of `terminology.json` canonical terms
- Links to `docs/standards/terminology.json` as the authoritative terminology source

### performance-budget.json (125 lines)

- **Core Web Vitals**: LCP 2500ms, FID 100ms, INP 200ms, CLS 0.1
- **Lighthouse**: Minimum performance score 90
- **Bundle**: Max JS 150KB, max CSS 50KB (gzip compressed)
- **Assets**: Max image 200KB, allowed formats (SVG/WebP/AVIF), 2 font families, 4 weights max
- **Accessibility**: WCAG 2.1 AA contrast ratios (4.5:1 body, 3:1 large text, 3:1 UI), 44px min touch target
- **SEO**: Title max 60 chars, description max 160 chars, required structured data schemas, OG image 1200x630
- **Responsive**: Breakpoints at 375/768/1024/1440px

## Benefits

- **Automated enforcement**: Phase 8 lint scripts can now `JSON.parse()` a single file instead of parsing markdown prose
- **Cursor rule context**: Phase 6 rules can inject structured requirements instead of pasting entire markdown sections
- **Single source of truth**: One file per domain (content, copy, performance) — no scattered thresholds
- **Actionable banned phrases**: Each entry includes why it's banned and what to write instead, enabling auto-fix suggestions
- **Versioned schema**: `"version": "1"` field enables future schema evolution without breaking consumers

## Impact

- Unblocks Phase 4 (templates) and Phase 5 (component standards), which can now run in parallel
- Unblocks Phase 8 (lint tooling), which will read these JSON files directly
- Forward-reference links in `website-standards.md` (lines 9-13) now resolve to real files
- The `site/standards/` directory is now feature-complete for its data layer (5 files: 2 markdown + 3 JSON)

## Related Work

- Follows the pattern established by `docs/standards/terminology.json` (23 canonical terms in JSON)
- Phase 1: `site/standards/website-standards.md` (source of all rules)
- Phase 2: `site/standards/information-architecture.md` (source of linking/persona data)
- Phase 4 (next): Page and section templates in `site/standards/templates/`
- Phase 8 (future): Lint scripts that consume these JSON files

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~30 minutes)
