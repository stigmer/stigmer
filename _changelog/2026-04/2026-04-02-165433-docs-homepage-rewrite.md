# Docs Homepage Rewrite — Active Links and Coming Soon Sections

**Date**: April 2, 2026

## Summary

Rewrote the documentation homepage (`docs/index.mdx`) to eliminate dead links
and provide a clear entry point for new users. The page now separates active
content (Quickstart, Your first Skill) from future sections tagged "Coming soon"
with non-clickable cards.

## Problem Statement

The existing homepage had four equal-weight cards, three of which linked to pages
that don't exist yet (Core Concepts, Tutorials, SDK Reference). Clicking them
produced 404 errors, undermining trust and confusing new users.

### Pain Points

- 3 of 4 homepage cards were dead links
- No visual distinction between available and planned content
- Generic routing hub tone — didn't guide new users toward the getting started flow

## Solution

Split the homepage into two sections:

- **Get started** — two cards linking to the existing Quickstart and Your first
  Skill pages, forming the complete cloud onboarding arc
- **Coming soon** — four cards (Core Concepts, Tutorials, SDK Reference, CLI
  Reference) with no `href`, visually tagged "Coming soon" in the description

## Implementation Details

- Single file change: `docs/index.mdx`
- Cards without `href` render as inert blocks (Fumadocs Card component behavior)
- Updated orientation paragraph to reflect platform value proposition
- Title casing aligned with sidebar naming (Quickstart, not Cloud quickstart)

## Benefits

- Zero dead links on the homepage
- New users are routed directly into the getting started flow
- Future sections are visible (full vision) but not clickable (no broken experience)
- Easy to convert "Coming soon" cards to active links as pages are built

## Impact

- Documentation homepage visitors see a clear, trustworthy entry point
- Part of the Session 3 Getting Started revision
  (`_projects/2026-04/20260401.02.sp.getting-started-revision/`)

---

**Status**: Production Ready
