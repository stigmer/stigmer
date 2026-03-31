# Demo Story Narrative — Phase 1 Deliverable 3

**Date**: March 31, 2026

## Summary

Created the demo story narrative — the third of five Phase 1 content strategy deliverables. This document defines a reusable before/after narrative framework tied to Stigmer's three messaging pillars, a full primary story (e-commerce platform), two variant sketches (property management, logistics), and polished draft copy blocks for Phase 2 sales site implementation.

## Problem Statement

The positioning document (deliverable 1) defines what Stigmer is and who it's for. The vocabulary guide (deliverable 2) standardizes how we talk about it. But neither makes the positioning *concrete*. A technical founder reading "Build agents that work for your business" needs to see what that looks like in practice — the before state they recognize, the transformation steps, and the production outcome.

### Pain Points

- The positioning pillars (Knows Your Business / Uses Your Tools / Asks Before Acting) are abstract claims without a concrete story
- Phase 2's sales site needs a "Demo Story" homepage section but has no narrative source material
- Multiple industries could anchor the story — the right choice depends on audience resonance and pillar coverage
- The narrative needs to work in sales-site register (no technical jargon) while remaining technically accurate

## Solution

A strategic narrative document at `design-decisions/demo-story.md` that serves as the single source of truth for Stigmer's before/after transformation story. Structured as a reusable framework plus a primary story plus variant sketches, with a capability map that Phase 2 can draw from directly.

## Implementation Details

### Narrative Framework (reusable across all stories)

Five-beat arc mapping to the positioning document:

| Beat | Maps to | Transformation |
|------|---------|---------------|
| Before | Competitive frame (vs. Direct LLM API) | The founder's reality with generic AI |
| Act 1 — Teach | Pillar 1: Knows Your Business | Generic to domain expert |
| Act 2 — Connect | Pillar 2: Uses Your Tools | Talks about things to does things |
| Act 3 — Rules | Pillar 3: Asks Before Acting | Does things to does things safely |
| After | Foundation: Built for Production | Running in production as a product feature |

### Scenario Selection

Evaluated four candidates (e-commerce, property management, helpdesk, logistics) against five criteria: audience resonance, pillar coverage, before/after contrast, generalizability, and competitive differentiation. E-commerce platform selected — scores highest on audience resonance and generalizability while naturally covering all pillars.

### Primary Story: E-Commerce Platform

A founder of a multi-vendor marketplace adding AI agent capabilities as a platform feature. Each merchant gets an agent that knows their business (return policies, product catalog), uses their systems (order lookup, return initiation), and follows their rules (refund approvals above a threshold). The "before" is a generic chatbot that gives wrong answers and can't take actions — a pain point every technical founder recognizes.

### Variant Sketches

- **Property management SaaS**: Per-building rules, maintenance ticketing, lease modification approvals
- **Logistics platform**: SLA-aware answers, real-time shipment tracking, cost-based rerouting approvals

### Quality Controls

- Every term checked against the vocabulary guide's sales-site column
- Every capability claim traced to the positioning document
- Technical accuracy verified against the architect role's domain model
- Readability verified against the document writer role's plain language standard

## Benefits

- Phase 2 has a clear narrative source for the homepage Demo Story section
- The five-beat framework is reusable for conference talks, blog posts, and future use case pages
- Draft copy blocks in the capability map give Phase 2 a strong starting point
- Variant sketches prove the framework generalizes beyond a single industry

## Impact

- **Sales site**: Provides the narrative backbone for the most important homepage section after the hero
- **Content strategy**: Establishes a repeatable pattern for telling Stigmer's story across contexts
- **Phase 1 progress**: 3 of 5 deliverables complete (Positioning + Vocabulary + Demo Story)

## Related Work

- [Positioning document](../_projects/2026-03/20260331.01.content-strategy/design-decisions/positioning.md) — source for messaging pillars and competitive framing
- [Vocabulary guide](../docs/vocabulary.md) — source for sales-site register terminology
- Previous changelog: `2026-03-31-205625-vocabulary-guide-single-source-of-truth.md`

---

**Status**: Draft, pending review
**Timeline**: Session 4 of content strategy project
