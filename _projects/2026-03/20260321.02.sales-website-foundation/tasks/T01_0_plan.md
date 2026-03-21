# Task T01: Sales Website Foundation — Standards, Templates, and Enforcement

**Created**: 2026-03-21
**Status**: Approved — Ready for Execution

---

## Overview

This project establishes the standards infrastructure for the Stigmer sales website (`site/`), mirroring what the documentation-foundation project created for `docs/`. The goal is to create patterns, templates, machine-readable rules, and enforcement mechanisms so that every AI-assisted conversation about the sales website produces consistently high-quality, conversion-optimized output.

**This project does NOT build content.** It builds the system that ensures content quality. A follow-up project will use these standards to revamp the actual website pages.

### Reference Model

The documentation foundation project delivered:
- `docs/standards/documentation-standards.md` — master standards
- `docs/standards/information-architecture.md` — navigation and URL scheme
- `docs/standards/terminology.json` — machine-readable terminology (23 canonical terms)
- `docs/standards/templates/` — 7 content-type templates
- `.cursor/rules/docs/documentation-standards.mdc` — auto-apply rule
- `.cursor/rules/docs/write-documentation.mdc` — action rule for writing
- `.cursor/rules/docs/review-documentation.mdc` — action rule for review
- `_reminders/004_documentation-standards.md` — quick-reference reminder

This project produces the parallel set for `site/`.

---

## Research Findings

### Current State of the Sales Website

The site is a static Next.js 15 app (React 19, Tailwind v4, Framer Motion) with a single landing page containing four sections:

1. **Hero** — "Build Agents. Skip the Infrastructure." + badges + CTAs + install command
2. **Features** — 6-card grid (Declarative YAML, Durable Execution, MCP Tool Protocol, Human-in-the-Loop, Local-First, Platform for Platforms)
3. **Architecture** — 3-column "How it works" + "Platform vs framework" + developer journey
4. **Quickstart** — 5-step install-to-integrate flow with code blocks

**What exists and is reusable:**
- Component variant system (Card: glass/feature/bordered, Badge: cyan/emerald/purple, Button: outline/ghost)
- Framer Motion animation library (`lib/animations.ts`) with stagger, spring, viewport variants
- Design token system in `globals.css` (HSL tokens, glow, glass, durations)
- Geist Sans + Geist Mono font pairing
- Dark theme with `--primary` (blue) and `--accent` (purple)
- JSON-LD structured data (Organization, SoftwareApplication, WebSite)
- Lighthouse baselines (baseline and final JSON files exist)

**What is missing (from roles 007/008/009 analysis):**
- No defined page types beyond "homepage"
- No section templates (each section is ad-hoc)
- No content requirements (what must a feature card include?)
- No copy standards beyond what's in the roles (not machine-enforceable)
- No performance budget (Lighthouse baselines exist but no enforcement)
- No component naming conventions or required props documentation
- No page map or information architecture for multi-page site
- No funnel-stage tagging system
- No quality review process
- No Cursor rules for `site/` edits

### Existing Roles and Reminders

**Roles (strengths):**
- 007 (Growth Marketing Strategist): Comprehensive positioning, 3 personas, competitive landscape, funnel stages, Marketing Strategy Brief process
- 008 (Sales Website Designer): Narrative architecture, CTA hierarchy, performance targets, accessibility standards, responsive breakpoints, Design Brief process
- 009 (Developer Copywriter): Benefits-over-features, developer authenticity, specificity-over-vagueness, objection-aware writing, SEO discipline, Copy Brief process

**Roles (gaps):**
- None reference concrete standards documents (because they don't exist yet)
- None reference `terminology.json` for product terms on the sales site
- No "Reference Documents" section pointing to enforceable standards
- The quality standards are described in prose but not in a machine-checkable format

**Reminders (strengths):**
- 005 (Sales Website Mindset): Conversion funnel, section job definitions, developer audience principles
- 006 (Developer Marketing Principles): Show-don't-tell, honesty, technical depth, banned patterns, quality checklist

**Reminders (gaps):**
- No `007_website-standards.md` equivalent of `004_documentation-standards.md`
- No pointer to where the standards, templates, and rules live

---

## Deliverables

### Phase 1: Master Standards Document

**Deliverable:** `site/standards/website-standards.md`

The authoritative reference for all sales website decisions. Parallel to `docs/standards/documentation-standards.md`.

Contents:
1. **Mandates** — Non-negotiable rules (5-7 mandates covering conversion, copy, design, performance, accessibility, SEO, consistency)
2. **Page Types** — All 9 page types the sales website supports (homepage, use-case, comparison, feature, landing, pricing, changelog, blog, community), with purpose, audience, funnel stage, required sections, and template reference
3. **Section Types** — Every reusable section type (hero, features, CTA band, comparison, code showcase, social proof, FAQ), with required elements and quality criteria
4. **Copy Rules** — Writing style for sales copy (distinct from docs style), banned phrases, required specificity, tone requirements
5. **Design Rules** — Component usage, spacing scale, typography hierarchy, color system, animation guidelines
6. **Performance Requirements** — Core Web Vitals targets, bundle budget, image strategy, font strategy, animation budget
7. **Accessibility Requirements** — WCAG 2.1 AA, contrast ratios, keyboard nav, screen reader, reduced motion
8. **SEO Requirements** — Title tags, meta descriptions, heading hierarchy, structured data, internal linking
9. **Quality Checklist** — Pre-merge verification list (parallel to docs quality checklist)

### Phase 2: Information Architecture

**Deliverable:** `site/standards/information-architecture.md`

Defines the complete page map, navigation structure, and URL scheme for the multi-page sales website.

Contents:
1. **Page Map** — Every page the site needs, organized by funnel stage (awareness → interest → evaluation → action), with persona mapping
2. **Navigation Structure** — Header nav, footer nav, mobile nav, breadcrumbs
3. **URL Scheme** — Predictable URL patterns for each page type
4. **Internal Linking Rules** — How pages connect through the funnel (interest page → evaluation page → action page)
5. **Page Inventory** — Current pages vs. planned pages, with priority ordering

### Phase 3: Machine-Readable Standards

Three JSON files that enable automated enforcement:

**Deliverable:** `site/standards/content-requirements.json`

Machine-readable definition of what every page type and section type MUST contain. Similar in spirit to `terminology.json` but for content structure.

```json
{
  "version": "1",
  "page_types": {
    "homepage": {
      "required_sections": ["hero", "features", "how-it-works", "quickstart", "cta-band"],
      "required_metadata": ["title", "description", "og:image"],
      "funnel_stages": ["awareness", "interest", "action"],
      "personas": ["all"]
    },
    "use-case": {
      "required_sections": ["hero", "problem", "solution", "proof", "cta-band"],
      "required_metadata": ["title", "description", "og:image", "persona"],
      "funnel_stages": ["interest", "evaluation"],
      "personas": ["specific"]
    }
  },
  "section_types": {
    "hero": {
      "required_elements": ["headline", "subheadline", "primary_cta", "secondary_cta"],
      "max_headline_words": 8,
      "must_include_code": false,
      "above_fold": true
    }
  }
}
```

**Deliverable:** `site/standards/copy-guidelines.json`

Machine-readable copy rules extending `terminology.json` for the sales context.

```json
{
  "version": "1",
  "scope": "site/**/*.{tsx,ts}",
  "banned_phrases": [
    "revolutionary", "game-changing", "seamless", "best-in-class",
    "enterprise-grade", "next-generation", "powerful", "easy to use",
    "unlock the potential", "digital transformation", "synergy"
  ],
  "required_patterns": {
    "every_claim_needs_proof": true,
    "code_before_paragraph": true,
    "specific_numbers_over_adjectives": true
  },
  "terminology_source": "../../docs/standards/terminology.json"
}
```

**Deliverable:** `site/standards/performance-budget.json`

Machine-readable performance targets that lint tooling can validate.

```json
{
  "version": "1",
  "core_web_vitals": {
    "lcp_ms": 2500,
    "fid_ms": 100,
    "cls": 0.1
  },
  "bundle": {
    "max_js_kb": 150,
    "max_css_kb": 50
  },
  "assets": {
    "max_image_kb": 200,
    "max_font_families": 2,
    "max_font_weights": 4
  }
}
```

### Phase 4: Page and Section Templates

**Deliverable:** `site/standards/templates/`

Markdown templates defining the required structure for each page type and section type. These are NOT code — they are content specifications that the Cursor rules reference when a page is being created or reviewed.

**Page templates (9 types):**
- `homepage.md` — Required sections, content hierarchy, CTA strategy, proof points
- `use-case-page.md` — Persona-specific use-case pages (problem → solution → proof → action)
- `comparison-page.md` — "Stigmer vs X" honest comparison pages
- `feature-page.md` — Deep-dive pages for major capabilities
- `landing-page.md` — Campaign or launch landing pages
- `pricing-page.md` — Pricing tiers, feature comparison, CTA per tier, FAQ
- `changelog-page.md` — Release notes, version history, migration guides
- `blog-page.md` — Technical blog posts, tutorials, announcements
- `community-page.md` — Community resources, contribution guides, ecosystem

**Section templates:**
- `section-hero.md` — Above-fold requirements: headline (<8 words), subheadline, primary CTA, secondary CTA, visual anchor
- `section-features.md` — Feature grid/list: benefit-first descriptions, icon, proof point for each
- `section-cta-band.md` — Call-to-action band: headline, supporting copy, primary + secondary CTA
- `section-comparison.md` — Comparison table: honest, specific, fair; acknowledge competitor strengths
- `section-code-showcase.md` — Code example section: minimal, impressive, self-explanatory; copy button
- `section-social-proof.md` — Social proof: GitHub metrics, contributor activity, real usage; no vanity metrics
- `section-how-it-works.md` — Step-by-step flow with visual progression
- `section-faq.md` — FAQ with structured data (JSON-LD FAQPage schema)

### Phase 5: Component Standards

**Deliverable:** `site/standards/component-standards.md`

Defines the naming conventions, required props, and quality criteria for **new** marketing components in `site/src/components/`. Existing components are not required to be retroactively compliant — they are audited only when touched.

Contents:
1. **Component Taxonomy** — atoms (Button, Badge, CodeBlock), molecules (FeatureCard, CTABand, ComparisonRow), organisms (HeroSection, FeatureGrid, ComparisonTable), pages (HomePage, UseCasePage)
2. **Naming Conventions** — PascalCase components, camelCase props, kebab-case files; marketing components stay in `site/src/components/`, never leak to SDK
3. **Required Props** — Every component must accept: `className` for composition, `id` for anchor linking, `aria-*` for accessibility
4. **Styling Rules** — Use Tailwind utilities; no arbitrary values; spacing follows the scale; dark theme first; no inline styles
5. **Animation Rules** — Use animation variants from `lib/animations.ts`; no inline `animate` props; respect `prefers-reduced-motion`
6. **Responsive Requirements** — Test at 375px, 768px, 1024px, 1440px; touch targets ≥44px; code blocks horizontally scrollable
7. **Accessibility Requirements** — Semantic HTML, ARIA where needed, keyboard navigable, focus-visible indicators, contrast ratios

### Phase 6: Cursor Rules

Three Cursor rules that auto-enforce the standards during development:

**Deliverable:** `.cursor/rules/site/website-standards.mdc`
- **Activation:** Auto-applies on `site/**/*.{tsx,ts,css}` edits
- **Content:** Injects the master standards (mandates, page types, section types, copy rules, performance budget, quality checklist) into context
- References `site/standards/website-standards.md`, `content-requirements.json`, `copy-guidelines.json`, `performance-budget.json`

**Deliverable:** `.cursor/rules/site/write-website-content.mdc`
- **Activation:** Invoke as `@write-website-content` when creating or modifying a page
- **Process:** Page Type Identification → Audience/Funnel Audit → Template Compliance Check → Copy Brief → Design Brief → Implementation
- Enforces: correct template, required sections, CTA hierarchy, proof points, SEO metadata

**Deliverable:** `.cursor/rules/site/review-website-content.mdc`
- **Activation:** Invoke as `@review-website-content` for quality review before merge
- **Process:** Standards compliance → Copy quality → Design quality → Performance → Accessibility → SEO → Final checklist
- References the quality checklist from `website-standards.md`

### Phase 7: Reminder and Role Updates

**Deliverable:** `_reminders/007_website-standards.md`

Quick-reference reminder parallel to `004_documentation-standards.md`. Points to:
- Master standards document
- Content requirements JSON
- Copy guidelines JSON
- Performance budget JSON
- Templates directory
- Cursor rules
- Quality checklist

**Deliverable:** Update roles 007, 008, 009

Add a "Reference Documents" section at the top of each role (below DOMAIN CONTEXT) that points to the standards artifacts. Additionally, review and strengthen role content where the standards work reveals gaps or improvements — not just a mechanical "add a section" update.

### Phase 8: Lint Tooling

All lint scripts exit with non-zero status on violations (error mode, not warnings). Violations must be fixed before merge — no exceptions.

**Deliverable:** `site/scripts/lint-copy.ts`
Script that scans TSX files in `site/src/` for:
- Banned phrases from `copy-guidelines.json`
- Missing `aria-*` attributes on interactive elements
- Hardcoded colors/sizes not using design tokens

**Deliverable:** `site/scripts/lint-pages.ts`
Script that validates page components against `content-requirements.json`:
- Required sections present for page type
- Required metadata (title, description, og:image) present
- CTA hierarchy (primary + secondary) present

**Deliverable:** `site/scripts/lint-performance.sh`
Shell script that:
- Runs Lighthouse CI against performance-budget.json thresholds
- Checks bundle size against limits
- Reports violations

**Deliverable:** Makefile integration
Add `lint-website` target to `site/Makefile` that runs all three lints. Wire into `make check` so website lints run alongside existing checks.

---

## Scope

### In Scope
- All standards documents, JSON files, and templates in `site/standards/`
- All three Cursor rules in `.cursor/rules/site/`
- New reminder `_reminders/007_website-standards.md`
- Updates to roles 007, 008, 009 (Reference Documents section + content strengthening)
- Lint scripts in `site/scripts/` (error mode — non-zero exit on violations)
- Makefile integration: `lint-website` target + wired into `make check`

### Out of Scope
- Building or rewriting actual website pages (follow-up project)
- Creating new React components (follow-up project)
- Writing final sales copy (follow-up project)
- SEO keyword research (follow-up project, informed by IA)
- Analytics instrumentation (follow-up project)
- A/B testing infrastructure (follow-up project)
- Design mockups or Figma files (the standards define requirements, not pixel-level design)

---

## Execution Order

The phases have dependencies:

```
Phase 1 (website-standards.md)
    ↓
Phase 2 (information-architecture.md) ←── depends on page types defined in Phase 1
    ↓
Phase 3 (JSON files) ←── depends on rules codified in Phases 1-2
    ↓
Phase 4 (templates) ←── depends on page/section types from Phases 1-2
    ↓
Phase 5 (component-standards.md) ←── depends on design rules from Phase 1
    ↓
Phase 6 (Cursor rules) ←── references all artifacts from Phases 1-5
    ↓
Phase 7 (reminder + role updates) ←── references all artifacts from Phases 1-6
    ↓
Phase 8 (lint tooling) ←── reads JSON files from Phase 3, validates patterns from Phases 1-5
```

Phases 4 and 5 can run in parallel after Phases 1-2 are complete.

---

## Resolved Decisions

All open questions were reviewed and decided on 2026-03-21:

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | Standards location | `site/standards/` | Keeps standards co-located with the code they govern, parallel to `docs/standards/`. |
| 2 | Page types | **9 types**: homepage, use-case, comparison, feature, landing, pricing, changelog, blog, community | Covers the full site needs from day one. Better to define all types now than retrofit later. |
| 3 | Lint strictness | **Error** (non-zero exit). Wired into `make check`. | Strict enforcement ensures standards are followed. Violations must be fixed before merge. |
| 4 | Component standards scope | **New components only.** Existing code audited only when touched. | Avoids a retroactive compliance project. Standards apply going forward. |
| 5 | Role update scope | **Reference Documents section + strengthen content** where warranted. | Standards creation may reveal gaps in roles; take the opportunity to improve them. |

---

## Success Criteria

- [ ] `site/standards/website-standards.md` exists with mandates, page types, section types, copy rules, design rules, performance requirements, accessibility requirements, SEO requirements, and quality checklist
- [ ] `site/standards/information-architecture.md` exists with page map, navigation structure, URL scheme, and internal linking rules
- [ ] `site/standards/content-requirements.json` defines requirements for every page type and section type
- [ ] `site/standards/copy-guidelines.json` defines banned phrases, required patterns, and terminology source
- [ ] `site/standards/performance-budget.json` defines Core Web Vitals targets and bundle/asset limits
- [ ] `site/standards/component-standards.md` defines naming, props, styling, animation, responsive, and accessibility requirements
- [ ] `site/standards/templates/` contains templates for all 9 page types and all 8 section types
- [ ] `.cursor/rules/site/website-standards.mdc` auto-applies on `site/` edits
- [ ] `.cursor/rules/site/write-website-content.mdc` enforces the page creation process
- [ ] `.cursor/rules/site/review-website-content.mdc` enforces the quality review process
- [ ] `_reminders/007_website-standards.md` exists as quick-reference
- [ ] Roles 007, 008, 009 updated with Reference Documents section and content strengthened where warranted
- [ ] `site/scripts/lint-copy.ts` validates copy against `copy-guidelines.json`
- [ ] `site/scripts/lint-pages.ts` validates page structure against `content-requirements.json`
- [ ] `site/Makefile` includes `lint-website` target wired into `make check`
- [ ] All lint scripts exit non-zero on violations (error mode, not warnings)

---

## Risk Mitigations

| Risk | Mitigation |
|---|---|
| Over-engineering standards before real content exists to validate | Keep templates practical and concrete. Write them as if you're about to create the page — not as abstract theory. Plan to iterate when the content project starts. |
| Standards too rigid, slowing down iteration | Frame standards as "minimum requirements," not "maximum allowed." Mandate the floor (every page must have X), not the ceiling. |
| Lint tooling scope creep | Start with simple script-based checks (grep for banned phrases, AST check for required sections). Defer custom ESLint plugin rules unless the simple approach proves insufficient. |
| Inconsistency between standards and existing site code | Explicitly note that existing code is not required to be retroactively compliant. Standards apply to new and modified content. Audit existing code only when touched. |
| Standards that sound good in theory but don't work in practice | Validate each standard by mentally "building" a page against it. If a template makes the page awkward, the template is wrong. |
