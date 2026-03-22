# ProblemStatement Doc Component

**Date**: March 22, 2026

## Summary

Built the ProblemStatement component for the docs-kit package — a visual container for the "what goes wrong" problem section on concept pages. This completes the minimum viable component set for rewriting concept docs with components (Phase 3 is now unblocked).

## Problem Statement

Concept doc problem sections (narrative + code anti-pattern + consequence bullets) looked identical to surrounding prose. Scanning readers had no visual landmark to distinguish the "here's the problem" section from the rest of the page. The plan called for a component with "visually distinct 'what goes wrong' with icon bullets."

### Pain Points

- Problem sections blended into surrounding prose with no visual break
- No scannable signal for developers who skim before reading
- Phase 3 (rewrite `what-is-stigmer.mdx` with components) was blocked until this component existed

## Solution

Built a visual container component that wraps arbitrary MDX children (prose, code blocks, consequence bullets) in a distinct `<section>` with muted background, a `fd-muted-foreground` left bar, and descendant CSS for bullet marker styling.

## Implementation Details

### Design Discussion

Evaluated three approaches before choosing:

- **Option A (chosen): Visual container** — wraps entire problem section as arbitrary MDX children. Simplest API, no sub-components.
- **Option B: Focused list** — only wraps consequence bullets. Fragments the visual story.
- **Option C: Hybrid with `<Problem>` sub-components** — adds JSX boilerplate without structural benefit; most fragile MDX composition pattern.

Option A won because all 5 concept pages share identical internal structure (narrative → code → "What goes wrong:" → bullets). Content authors follow this organically — the component provides the visual signal without enforcing redundant sub-structure.

### Component

- **File**: `site/packages/docs-kit/components/ProblemStatement.tsx`
- **Element**: `<section>` (content section, not supplementary — unlike DefinitionBanner's `<aside>`)
- **API**: `children: ReactNode` only
- **Visual**: `bg-fd-muted/30` background, `fd-muted-foreground` left bar (differentiated from DefinitionBanner's `accent` bar), no shadow
- **Prose**: inherits Fumadocs prose styling (no `not-prose`) for code blocks, lists, paragraphs

### Key Constraint

Heading stays in MDX (`## The problem X solves`) for Fumadocs TOC extraction — same pattern as RelatedDocs. The component renders only the content beneath the heading.

## Benefits

- **Phase 3 unblocked**: DefinitionBanner + ComparisonTable + RelatedDocs + ProblemStatement = minimum viable set for rewriting `what-is-stigmer.mdx`
- **Scannable problem sections**: Muted container with left bar creates visual landmark distinct from neutral prose
- **Simple DX**: One prop (`children`), no configuration, standard MDX composition

## Impact

- 1 new component file
- Build verified: `yarn typecheck` and `yarn build` both pass clean (13 pages, all 7 docs)

## Related Work

- Preceded by: `2026-03-22-083836-docs-kit-batch-1-components.md` (DefinitionBanner, ComparisonTable, RelatedDocs)
- Enables: Phase 3 — rewrite `docs/concepts/what-is-stigmer.mdx` using the component library

---

**Status**: Production Ready
**Timeline**: Session 4 (March 22, 2026)
