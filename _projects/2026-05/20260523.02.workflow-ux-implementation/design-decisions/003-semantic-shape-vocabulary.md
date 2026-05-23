# Decision 003: Semantic Shape Vocabulary for Nodes

**Date**: 2026-05-23
**Status**: Proposed
**Source**: Deep research report, BPMN/UML standards

## Context

All task nodes currently render as identical rectangular cards. The only differentiation is a thin colored left border stripe (by category) and a text badge. This fails:
- **Scanability**: Users can't quickly understand workflow structure at a glance
- **WCAG 1.4.1**: Color must not be the only means of conveying information
- **User expectations**: Diamonds for decisions and bars for forks are universal conventions

## Decision

Use a small, opinionated shape vocabulary with three levels of differentiation:

**Level 1 — Macro shape** (6 shapes):
- `task-card` (rounded rectangle) — Agent Call, LLM Call, HTTP, gRPC, etc.
- `decision-diamond` — Switch Case
- `parallel-bar` (thick horizontal bar) — Fork/Join
- `event-circle` — Wait, Listen, Raise Error
- `terminal-pill` — Start/End
- `container` — For Each, TryCatch, Run Workflow (double border)

**Level 2 — Icon**: agent/brain, sparkle, globe/API, person/hand, clock, shield, loop, etc.

**Level 3 — Chips**: model, method, branch count, approver, timeout, cost, status

## Consequences

- Need custom SVG shapes in React Flow custom nodes
- Need transparent rectangular hitboxes for non-rectangular shapes (diamond, circle)
- Handle positioning changes per shape type
- Labels may need external placement for small shapes (diamond, circle)
- More visually distinct and accessible workflow diagrams

## Alternatives Considered

- Unique shape per task kind (rejected: too many shapes become noisy)
- Color-only differentiation (rejected: fails WCAG, insufficient scanability)
- Full BPMN notation (rejected: over-engineered for this use case)
