# Component Standards for Sales Website

**Date**: March 21, 2026

## Summary

Created `site/standards/component-standards.md` — the authoritative reference for how marketing components in `site/src/components/` should be built, named, styled, animated, and tested. This is Phase 5 of the sales-website-foundation project and resolves the last forward-reference link in the master standards document.

## Problem Statement

The sales website had no codified rules for component construction. Each component was built ad-hoc, leading to inconsistencies in prop interfaces, color usage, animation patterns, and accessibility compliance.

### Pain Points

- No standard for which props every component must accept (`className`, `id`)
- Hardcoded colors (rgba values, Tailwind color names) instead of design tokens in some components
- Arbitrary CSS values (`text-[11px]`) breaking the Tailwind scale
- Inconsistent `forwardRef` and `displayName` usage across atoms
- Inline animation durations instead of using the centralized `lib/animations.ts` presets
- No documented decision boundary for when a component is an atom vs molecule vs organism

## Solution

A single markdown document (`site/standards/component-standards.md`) with 7 normative sections, a 30-item quality checklist, and a non-normative audit of existing component inconsistencies.

## Implementation Details

The document covers:

1. **Component Taxonomy** — Atoms, molecules, organisms, pages with concrete decision boundaries (not abstract definitions)
2. **Naming Conventions** — File naming, component naming, props types, variant definitions, internal subcomponents
3. **Required Props Interface** — `className`, `id`, HTML attribute spread, `forwardRef`/`displayName`, organism-specific `aria-labelledby`
4. **Styling Rules** — Tailwind-only (no arbitrary values), full design token inventory from `globals.css`, `cva` variant pattern, `cn()` merging
5. **Animation Rules** — Variant catalog from `lib/animations.ts`, transition presets, wrapper components from `motion.tsx`, GPU-only, reduced motion compliance
6. **Responsive Requirements** — Mobile-first, 4 breakpoints, 44px touch targets, code block scrolling
7. **Accessibility Requirements** — Semantic HTML, heading hierarchy, ARIA patterns, keyboard nav, contrast ratios

Every pattern in the document references the existing canonical implementation rather than inventing new conventions.

The appendix catalogs 12 specific inconsistencies found across 19 existing components. These are marked as non-normative — existing code is audited only when modified.

## Benefits

- AI-assisted development now has explicit rules for component construction — no more guessing whether to use `cva` or inline conditionals, design tokens or Tailwind colors
- The 30-item quality checklist provides a concrete pass/fail gate for component PRs
- The component audit gives developers a map of what needs attention when they touch existing components
- The full design token inventory (from `globals.css`) is now documented in one place instead of requiring developers to read the CSS file

## Impact

- **Standards completeness**: All forward-reference links in `website-standards.md` now resolve to real files — the standards corpus is complete through Phase 5
- **Cursor rule coverage**: The existing `.cursor/rules/site/website-standards.mdc` already references `component-standards.md`, so the auto-apply rule now has a complete backing document
- **Phase 8 readiness**: Lint tooling (the final phase) can now validate against the full standards set

## Related Work

- Phase 1: `site/standards/website-standards.md` — master standards (references this document on lines 15 and 357)
- Phase 3: `site/standards/copy-guidelines.json`, `content-requirements.json`, `performance-budget.json` — machine-readable rules
- Phase 4: `site/standards/templates/` — 17 page and section templates
- Phase 6: `.cursor/rules/site/` — 3 Cursor rules for enforcement

---

**Status**: Production Ready
**Timeline**: Phase 5 of 8 in the sales-website-foundation project
