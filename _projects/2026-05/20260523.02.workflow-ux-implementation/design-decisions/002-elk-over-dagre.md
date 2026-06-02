# Decision 002: ELK Layered Over Dagre for Auto-Layout

**Date**: 2026-05-23
**Status**: Proposed
**Source**: Deep research report

## Context

Current auto-layout uses `@dagrejs/dagre` which produces suboptimal results for complex workflows — nodes overlap, spacing is inconsistent, and the graph looks "algorithmic" rather than "designed." Dagre does not understand ports, compound nodes, or workflow-specific semantics.

## Decision

Replace dagre with **ELK Layered** (`elkjs`) as the primary auto-layout engine. Run ELK in a Web Worker.

ELK advantages for Stigmer:
- Port constraints (fixed port order for switch/fork branches)
- Compound/hierarchical nodes (foreach, try/catch containers)
- Model-order preservation (preserves YAML definition order)
- Orthogonal edge routing
- Incremental/semi-interactive layout support

Keep dagre only as a lightweight fallback for server-side or simple layout scenarios.

## Consequences

- New dependency: `elkjs`
- Need a Web Worker for layout computation on large graphs
- More complex configuration (ELK has many options)
- Need workflow-aware preprocessing before ELK (identify structures, assign ports)
- Better layout quality for complex workflows (branches, forks, loops)

## Alternatives Considered

- Stick with dagre (rejected: insufficient for workflow semantics)
- d3-dag (considered as secondary: lighter but less port/hierarchy support)
- GoJS/JointJS built-in layouts (rejected: licensing concerns for OSS project)
