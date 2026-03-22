# Docs Home Page Redesign

**Date**: March 22, 2026

## Summary

Redesigned the Stigmer docs home page from a 140-line explainer into a concise routing page with a 2-sentence product pitch and 4 navigation cards. The original "What is Stigmer?" content was relocated to the Concepts section where explanation content belongs.

## Problem Statement

The docs home page contained seven sections of explanation text — Why Stigmer exists, How it works, Building blocks, and more. While well-written, this forced visitors to read before they could act.

### Pain Points

- Visitors scan docs home pages for 3-5 seconds before clicking through or leaving
- A wall of prose on the front page buried the primary actions (Get Started, Concepts, Integration, Deploy)
- The page mixed Diataxis types: it was simultaneously a routing page and an explanation page
- No navigation cards to route users by intent

## Solution

Applied the industry-standard "Routing Page" pattern used by Temporal, Stripe, Vercel, and Supabase: short identity line, navigation cards, no long prose.

## Implementation Details

### New home page (`docs/index.mdx`)

- Title changed from "What is Stigmer?" to "Home"
- Added `full: true` frontmatter to hide the TOC panel
- 2-sentence identity line: what Stigmer is, what it does for you
- 4 navigation cards using Fumadocs built-in `<Cards>` and `<Card>` components:
  - **Getting Started** — Install and first Agent
  - **Core Concepts** — Agents, Workflows, Skills
  - **Integrate into Your Platform** — API, SDKs, React components
  - **Deploy** — Local mode and production

### Relocated content (`docs/concepts/what-is-stigmer.mdx`)

- All original explanation content preserved intact
- Terminal "Get started" section converted to a "Next steps" cross-link
- Added to `docs/concepts/meta.json` as first entry after the section index

## Benefits

- Home page is now 31 lines (down from 140) — scannable in 5 seconds
- Users are routed by intent rather than forced to read first
- Explanation content is properly placed in Concepts where it can be found via sidebar navigation
- No custom React components needed — uses Fumadocs built-in MDX components

## Impact

- `docs/index.mdx` — complete rewrite
- `docs/concepts/what-is-stigmer.mdx` — new file
- `docs/concepts/meta.json` — updated sidebar order

---

**Status**: Production Ready
