# Session 1: Governance and Strategy for Getting Started Revision

**Date**: April 1, 2026

## Summary

Established the governance foundations for the Getting Started documentation
revision. Updated the document writer role with 6 tutorial quality principles,
sharpened the information architecture to reflect the implicit assistant agent
design, documented the ScenarioPlayer component approach, and cleaned marketing
links from the docs sidebar.

## Problem Statement

Phase 3 delivered three Getting Started pages, but they had structural issues:
the Cloud Quickstart mixed SDK integration with skill creation (contradicting
the IA's 5-minute scope), pages lacked narrative continuity, the embedded demo
was static, and marketing links leaked into the docs sidebar. Before rewriting
content (Sessions 2-4), the governance documents needed to codify quality
principles and correct the structural blueprint.

### Pain Points

- No codified standards for tutorial quality — narrative continuity, aha-moment
  design, and page bridging were implicit expectations with no enforcement
- The IA described Cloud Quickstart as "create an Agent" when the actual design
  uses the implicit assistant agent (no agent creation needed)
- "Use Cases" and "GitHub" marketing links appeared in the Fumadocs docs chrome,
  cluttering the documentation navigation
- No documented approach for ScenarioPlayer — the experimental animated
  component needed a design decision record before prototyping

## Solution

Four governance deliverables, executed as Session 1 of the 4-session Getting
Started Revision plan.

## Implementation Details

### Document writer role (`_roles/002_document_writer.md`)

Added a new "Tutorial and learning path standards" section with 6 actionable
principles, each paired with a concrete test or example:

- **Narrative continuity**: sequential pages reference previous accomplishment
  and motivate the next page
- **Aha-moment design**: identify, state, deliver, and reinforce the emotional
  payoff
- **Progressive concept introduction**: one new concept per page, defer the rest
- **Implicit defaults**: use platform defaults, introduce configuration when
  needed
- **Embedded component standards**: real `@stigmer/react` components, animated
  playback preferred over static renders
- **Page bridging pattern**: "Next step" names the functional gap and what the
  next page teaches

Added a "Structural path decisions" sub-section that defers to the IA for
entry-point ordering and path convergence, avoiding duplication of the
cloud-primary principle.

### Information architecture (3 targeted edits)

1. **Site map table**: Cloud Quickstart description updated from "first agent in
   5 minutes" to "create session, send message — 5 minutes. Uses the implicit
   assistant agent."
2. **Getting Started detail**: quickstart.mdx description now explicitly states
   no agent creation needed, skill creation deferred to first-skill.mdx.
3. **Learning paths**: Added path quality requirement — every page must bridge to
   the next with a functional gap motivation.

### ScenarioPlayer design decision

New design decision document covering: problem (static demos), approach (timed
fixture delivery to real components via `framer-motion`), technical sketch,
dependencies, rejected alternatives (video/GIF, screenshots, off-the-shelf
libraries), risks, and prototype-first strategy. Grounded in the existing
`DemoTransport`/`createDemoClient` infrastructure.

### Docs sidebar cleanup

Removed the `links` array from `layout.shared.tsx` `baseOptions()`, which was
injecting "Use Cases" and "GitHub" into the Fumadocs docs layout. These
marketing links belong in the marketing site's Header/Footer (which has its own
navigation). `baseOptions()` is used exclusively by the docs layout.

## Benefits

- Tutorial quality principles are now enforceable — any future documentation
  can be reviewed against concrete tests
- The IA accurately reflects the Cloud Quickstart's actual design (implicit
  assistant agent), giving Session 3's content rewrite a clear target
- The docs sidebar is clean — only documentation pages, search, and the
  Stigmer icon (linking to the marketing homepage)
- ScenarioPlayer has a documented approach and prototype-first strategy,
  reducing risk of over-engineering in Session 2

## Impact

- **Document writer role**: governs all future tutorial and learning path
  content across the entire documentation site
- **Information architecture**: structural blueprint for Phases 3-7
- **Docs sidebar**: immediate visual improvement for all docs readers
- **ScenarioPlayer design decision**: guides Session 2 prototype work

## Related Work

- Parent project: 20260331.01.content-strategy
- Sub-project: 20260401.02.sp.getting-started-revision
- Predecessor: [Phase 3 Getting Started Documentation](_changelog/2026-04/2026-04-01-171833-phase-3-getting-started-documentation.md)
- Next: Session 2 (ScenarioPlayer Prototype)

---

**Status**: Production Ready
**Timeline**: Single session (~30 minutes)
