# Content Framework Cleanup — Phase 1: Clean Up

**Date**: March 21, 2026

## Summary

Replaced an over-engineered content governance system (49 files across roles, reminders, cursor rules, templates, and standards documents) with a lean, component-ready framework: 3 focused content roles, 2 text snippets, and 1 auto-apply terminology rule. This clears the path for Phase 2, where actual MDX/React components will replace static templates as the structural standard.

## Problem Statement

Two prior foundation projects (sales-website-foundation and docs setup) each produced their own content governance layer. The result was an accumulation of overlapping, heavyweight artifacts that made content creation harder rather than easier.

### Pain Points

- **4 content-adjacent roles** with overlapping responsibilities and no clear handoff boundaries
- **8 reminders** — long prose documents meant for AI context injection, but too verbose to be useful in every conversation
- **6 cursor rules** (3 docs, 3 site) — heavyweight auto-apply rules that tried to enforce standards through prose instructions instead of code
- **24 template files** (7 docs, 17 site) — static Markdown templates that couldn't enforce structure at render time and drifted from actual page implementations
- **6 redundant standards documents** — duplicated guidance already captured in JSON files and the new roles
- AI conversations required loading multiple overlapping documents just to start writing content

## Solution

A three-layer replacement architecture:

1. **Roles** define *who does what* — Content Designer (structure), Content Author (words), Content Engineer (components). Clear handoffs, no overlap.
2. **Snippets** provide *shared context* — two short texts (content-context, content-quality) that any content conversation can reference without role-switching.
3. **A single cursor rule** enforces *terminology* — the one thing that must be machine-checked on every edit, sourced from the existing JSON dictionaries.

Templates are not replaced in Phase 1. They will be replaced by actual React/MDX components in Phase 2 — the component becomes the standard by construction.

## Implementation Details

### New Files (6)

| File | Purpose |
|---|---|
| `_roles/010_content_designer.md` | Designs page structure using component compositions. Bridges raw content and effective communication. |
| `_roles/011_content_author.md` | Writes content that fills component slots. Separate voice for docs (neutral, precise) and site (confident, benefit-driven). |
| `_roles/012_content_engineer.md` | Builds React/MDX components where props enforce structure. The component IS the standard. |
| `_snippets/content-context.md` | One-paragraph Stigmer domain context, audience, and terminology reference. |
| `_snippets/content-quality.md` | Quality expectations: precision, active voice, show-don't-tell, component-based structure. |
| `.cursor/rules/content-terminology.mdc` | Auto-apply on `docs/**` and `site/src/**`. Enforces canonical proto names and bans marketing fluff. |

### Deleted Files (49)

| Category | Count | Details |
|---|---|---|
| Old roles | 4 | 002_document_writer, 007_growth_marketing_strategist, 008_sales_website_designer, 009_developer_copywriter |
| Reminders | 8 | Entire `_reminders/` directory |
| Cursor rules | 6 | documentation-standards, write-documentation, review-documentation, website-standards, write-website-content, review-website-content |
| Doc templates | 7 | adr, architecture, cli-reference, concept, how-to-guide, quickstart, sdk-guide |
| Site templates | 17 | homepage, landing-page, feature-page, comparison-page, blog-page, changelog-page, community-page, pricing-page, use-case-page, 8 section templates |
| Standards docs | 6 | documentation-standards.md, information-architecture.md (×2), website-standards.md, component-standards.md, content-requirements.json |
| Lint script | 1 | lint-pages.ts (depended on deleted content-requirements.json) |

### Modified Files (2)

- `site/Makefile` — removed `lint-pages` target, updated `lint-website` dependency
- `site/package.json` — removed `lint:pages` script, updated `lint:website` script

### Intentionally Preserved

- `docs/standards/terminology.json` — machine-readable canonical terms, consumed by the new cursor rule
- `site/standards/copy-guidelines.json` — banned phrases and tone rules, consumed by the new cursor rule
- `site/standards/performance-budget.json` — Core Web Vitals targets, consumed by lint-performance.sh
- `site/scripts/lint-copy.ts` and `site/scripts/lint-performance.sh` — still functional

## Benefits

- **6 → 3 roles** for content work, with explicit handoff boundaries (designer → author → engineer)
- **8 → 2 snippets** — shorter, more focused context injection
- **6 → 1 cursor rule** — auto-apply terminology enforcement only, no prose instructions
- **24 → 0 templates** — will be replaced by actual components in Phase 2
- **Net deletion: ~11,800 lines** of governance overhead
- AI conversations start faster: one role + two snippets vs. loading multiple overlapping documents

## Impact

- Content creators (human or AI) have a clear, lightweight framework to start from
- The path to Phase 2 (Docs Component Library) is unblocked — no conflicting templates or standards to reconcile
- Terminology enforcement is now automated via cursor rule rather than relying on manual adherence to prose documents
- Existing lint scripts (`lint-copy.ts`, `lint-performance.sh`) continue to function with their JSON data sources intact

## Related Work

- Preceded by: `20260321.02.sales-website-foundation` (created many of the now-deleted artifacts)
- Next: Phase 2 of this project — build the docs component library that replaces templates with real components
- Plan: `_projects/2026-03/20260321.04.content-framework-cleanup/tasks/T01_2_revised_plan.md`

---

**Status**: ✅ Phase 1 Complete
**Timeline**: Single session (~2 hours)
