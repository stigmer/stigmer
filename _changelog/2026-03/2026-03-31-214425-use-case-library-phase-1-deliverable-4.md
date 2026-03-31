# Use Case Library — Phase 1 Deliverable 4

**Date**: March 31, 2026

## Summary

Created the use case library — the fourth of five Phase 1 content strategy deliverables. This document defines a reusable "fit pattern" for identifying platforms where Stigmer adds value, five industry-specific use cases framed as platform builders shipping AI agent features, a capability coverage matrix, and card-ready content for Phase 2's homepage "What You Can Build" section.

## Problem Statement

The positioning document defines what Stigmer is. The vocabulary guide standardizes how we talk about it. The demo story proves the positioning through one deep narrative (e-commerce). But the demo story covers a single industry. A technical founder in healthcare, fintech, or legal tech needs to see their own world reflected — or at least recognize the pattern that makes their platform a fit.

### Pain Points

- The demo story proves depth in one scenario but doesn't demonstrate Stigmer's breadth across industries
- Phase 2's homepage needs a "What You Can Build" section with multiple use case cards but has no source material
- The T01 plan's candidate list is function-based (customer support, sales assistant) but the positioning targets platform builders — these are different lenses
- Without an abstract "fit pattern," the use case library is just a list rather than a tool for self-identification

## Solution

A strategic document at `design-decisions/use-cases.md` that serves as the source material for Phase 2's use case cards and `/use-cases` page. Structured as a reusable pattern + five concrete use cases + a coverage matrix + Phase 2 integration notes.

## Implementation Details

### The Pattern (new section, not in T01 spec)

Three conditions that identify platforms where Stigmer adds value:

1. **Per-tenant domain knowledge** — the platform serves multiple tenants, each with their own rules and procedures (Pillar 1)
2. **System actions** — the agent needs to act in the platform's systems, not just answer questions (Pillar 2)
3. **Risk-graduated decisions** — some actions are routine, others need human approval (Pillar 3)

This ensures readers in unlisted industries can self-identify. Tested against insurance, travel, and accounting — all three fit.

### Industry Selection

Five industries chosen for diversity of capability showcase, all avoiding overlap with the demo story (e-commerce, property management, logistics):

| Industry | Agent Feature | Primary Showcase |
|----------|--------------|-----------------|
| Healthcare SaaS | Patient intake and triage | Approval flows (clinical decisions) |
| HR / People platform | Employee onboarding | Multi-step automation (onboarding workflows) |
| FinTech / BaaS | Compliance monitoring | Per-tenant knowledge (regulatory rules) |
| EdTech | Course tutor | Persistent conversations (week-spanning sessions) |
| Legal tech | Contract analysis | Knowledge + approvals (high-stakes decisions) |

### Use Case Structure

Each use case follows an identical five-part structure: the builder (who), the challenge (pain), how Stigmer powers it (capabilities), a proof interaction (concrete agent dialogue), and the outcome (business result). Proof interactions are 2-3 lines — concrete enough to be believable, brief enough to not become mini demo stories.

### Design Decisions

- **No overlap with demo story**: All five industries are new. The demo story's variant sketches (property management, logistics) remain as narrative framework validation, not use case library entries.
- **Platform-builder lens**: Every use case is a SaaS founder adding AI to their product, consistent with the positioning document's primary audience.
- **Added the pattern section**: Not in the original T01 spec. Defines the abstract conditions before listing concrete examples, turning the document from a list into a lens.

### Quality Controls

- Every term checked against the vocabulary guide's sales-site column
- Every capability claim traced to the positioning document's messaging pillars
- Coverage matrix verified against actual use case content
- Pattern generalization tested against three industries not in the document

## Benefits

- Phase 2 has card-ready titles and one-liners for the homepage "What You Can Build" section
- The fit pattern gives prospects in any industry a way to self-identify
- Five industries provide diverse capability showcase across all messaging pillars
- The document stands alone — useful without reading the demo story

## Impact

- **Sales site**: Provides source material for homepage use case cards and the `/use-cases` page
- **Content strategy**: Demonstrates Stigmer's breadth complementing the demo story's depth
- **Phase 1 progress**: 4 of 5 deliverables complete (Positioning + Vocabulary + Demo Story + Use Cases)

## Related Work

- [Positioning document](../_projects/2026-03/20260331.01.content-strategy/design-decisions/positioning.md) — source for messaging pillars
- [Vocabulary guide](../docs/vocabulary.md) — source for sales-site register terminology
- [Demo story narrative](../_projects/2026-03/20260331.01.content-strategy/design-decisions/demo-story.md) — complementary depth (one industry, deep) vs. this document's breadth (five industries, concise)
- Previous changelog: `2026-03-31-212612-demo-story-narrative-phase-1-deliverable-3.md`

---

**Status**: Draft, pending review
**Timeline**: Session 5 of content strategy project
