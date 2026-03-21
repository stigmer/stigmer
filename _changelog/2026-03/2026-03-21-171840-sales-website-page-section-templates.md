# Sales Website Page and Section Templates

**Date**: March 21, 2026

## Summary

Created 17 specification templates (8 sections, 9 pages) that define the structure, copy guidance, design rules, and quality gates for every page and section type on the Stigmer sales website. These templates translate the machine-readable standards from Phases 1-3 into author-facing specifications that Cursor rules and human reviewers can enforce.

## Problem Statement

Phases 1-3 of the Sales Website Foundation project established standards, information architecture, and machine-readable requirements — but none of those artifacts are directly usable by someone writing a new page. An author looking to create a comparison page or a homepage hero would have to cross-reference multiple standards files, a JSON schema, and a 600-line IA document to understand what's required.

### Pain Points

- No single source of truth for "what goes on this page"
- Copy guidance buried in standards rather than surfaced at the point of authoring
- Quality checklist items scattered across performance, accessibility, and SEO documents
- Section requirements not linked to the pages that use them
- No way for Cursor rules to validate page completeness without a template to compare against

## Solution

A `site/standards/templates/` directory containing plain-markdown specification files, one per page type and one per reusable section type. Each template is a self-contained spec: it declares required elements, constraints, copy tone, design notes, structured data, and a quality checklist — everything an author (human or AI) needs to write a correct page.

Page templates reference section templates by relative link, creating a two-level spec system where section-level rules apply consistently across all pages that use that section.

## Implementation Details

### Section Templates (8 files)

| Template | Key Constraint | Lines |
|---|---|---|
| `section-hero.md` | ≤8-word headline, CTA hierarchy, code/terminal/badge visuals only | 75 |
| `section-features.md` | 3-6 cards, Benefit→Feature→Proof, proof per card | 72 |
| `section-how-it-works.md` | 3-5 numbered steps, progressive disclosure, artifact per step | 72 |
| `section-code-showcase.md` | Minimal self-explanatory code, copy button, context label | 73 |
| `section-comparison.md` | Acknowledge competitor strengths, "when to use each" required | 75 |
| `section-social-proof.md` | Auditable metrics only, honest early-stage framing | 74 |
| `section-cta-band.md` | Context-specific headline, "Learn More" banned as primary | 74 |
| `section-faq.md` | Visitor's voice, 3-sentence max per answer, FAQPage JSON-LD | 72 |

### Page Templates (9 files)

| Template | Priority | Sections Referenced | Lines |
|---|---|---|---|
| `homepage.md` | P0 | Hero, Features, How It Works, Code Showcase, CTA Band | 122 |
| `use-case-page.md` | P0 | Hero, How It Works, Code Showcase, Social Proof, CTA Band | 124 |
| `comparison-page.md` | P0 | Hero, Comparison, Code Showcase, Social Proof, CTA Band | 133 |
| `feature-page.md` | P1 | Hero, Code Showcase, How It Works, Social Proof, CTA Band | 124 |
| `landing-page.md` | P1 | Hero, Features or Code Showcase, Social Proof, CTA Band | 123 |
| `pricing-page.md` | P2 | Pricing tiers, FAQ, CTA Band | 130 |
| `changelog-page.md` | P2 | Changelog entries (categorized), CTA Band | 123 |
| `blog-page.md` | P3 | Article body, CTA Band | 126 |
| `community-page.md` | P3 | Contribution paths, Community links, CTA Band | 137 |

### Design Decisions

- **Markdown over MDX**: Templates are specifications, not components. Plain `.md` with HTML `<!-- -->` comments avoids importing MDX tooling into the standards directory.
- **Two-level structure**: Section templates define reusable rules; page templates compose sections and add page-specific overrides. Avoids duplicating section constraints in every page.
- **Quality checklists per template**: Each file ends with a concrete checklist that maps to the enforcement criteria for Cursor rules in Phase 6.

## Benefits

- **Single source of truth per page/section**: Authors look at one file to know all requirements.
- **Phase 6 ready**: Quality checklists are directly convertible into Cursor rule validation logic.
- **Consistent voice**: Copy guidance in every template enforces the Stigmer tone (benefit-first, developer-authentic, specific, show-don't-tell).
- **Accessibility and SEO baked in**: Every template includes WCAG 2.1 AA and structured-data requirements, so they're not afterthoughts.

## Impact

- **Authors** (human and AI): Can create spec-compliant pages without cross-referencing multiple standards files.
- **Reviewers**: Have a clear "what's required" reference for each page type.
- **Phase 6 (Cursor rules)**: Will encode these templates as machine-enforced validation rules.
- **Phase 7 (Role updates)**: Roles 007-009 will reference these templates as authoritative specs.

## Related Work

- [Sales Website Standards Document](2026-03-21-154558-sales-website-standards-document.md) — Phase 1 output that these templates codify
- [Sales Website Information Architecture](2026-03-21-155533-sales-website-information-architecture.md) — IA defining page types and URLs
- [Sales Website Machine-Readable Standards](2026-03-21-161715-sales-website-machine-readable-standards.md) — JSON requirements these templates translate

---

**Status**: ✅ Production Ready
**Timeline**: Phase 4 of 7 in the Sales Website Foundation project
