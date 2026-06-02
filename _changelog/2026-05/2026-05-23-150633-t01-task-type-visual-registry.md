# T01: Task Type Visual Registry — Unified Kind Metadata and Semantic Shape Foundation

**Date**: May 23, 2026

## Summary

Established the centralized Task Type Visual Registry as the single source of truth for workflow task kind metadata consumed by the canvas, topology graph, palette, and inspector. Eliminated the dual-system problem where canvas rendering used hardcoded Sets (with category drift) while the palette/inspector used the API-driven registry. Fixed two concrete category misclassifications (`validate` and `wait`), replaced underscore-to-space badge labels with proper display names, added `data-visual-class` and `data-task-kind` attributes to canvas nodes for T02/E2E targeting, and defined the 8-shape visual class taxonomy that T02's NodeShell will render.

## Problem Statement

The workflow codebase had two parallel kind-metadata systems that drifted out of sync:

- **System A**: API-driven `TaskKindDescriptor` (from server via `useTaskKindRegistry()`) drove palette grouping, picker search, inspector forms, and YAML validation.
- **System B**: Hardcoded client `Set`s (duplicated 3 times across `workflow-graph-conversions.ts`, `useWorkflowTopology.ts`, and `topologyFromTasks.ts`) drove canvas node colors, category classification, and kind labels.

### Pain Points

- `validate` was classified as `governance` (orange) in the client but `data` (green) in the proto sidecar — the authoritative source
- `wait` was classified as `event` (yellow) in the client but `control_flow` (blue) in the proto sidecar
- Canvas nodes displayed `"agent call"` (underscore-replace) while the palette showed `"Agent Call"` (registry displayName)
- The registry `icon` field (Lucide names) was stored but never rendered anywhere
- No semantic shape vocabulary existed — all task kinds rendered as identical rectangular cards
- No `data-*` attributes for E2E testing or CSS targeting of specific visual classes

## Solution

Created a two-module architecture: `kind-metadata.ts` (canonical category and display name mappings, aligned with proto sidecar YAMLs) and `task-type-visual-registry.ts` (semantic shape specifications for all 20 task kinds). Consolidated the 3 duplicated `categorizeKind()` implementations into the single canonical module, wired visual metadata into the canvas data pipeline, and added data attributes + enhanced ARIA labels to `CanvasTaskNode`.

## Implementation Details

### New Modules

**`kind-metadata.ts`** — Pure functions, zero React/proto dependencies:
- `categorizeKind(kind)` — replaces 3 duplicated implementations (2 string-based, 1 enum-based)
- `kindToDisplayName(kind)` — replaces `formatKindLabel()` (underscore-to-space) with proper sidecar-aligned display names
- Category values now match proto sidecar YAMLs exactly (`validate` → `data`, `wait` → `control_flow`)

**`task-type-visual-registry.ts`** — Static visual specifications:
- `VisualClass` union type: `task-card`, `decision-diamond`, `parallel-bar`, `event-circle`, `gate-octagon`, `subworkflow-card`, `container`, `terminal-pill`
- `TaskTypeVisualSpec` interface: `visualClass`, `defaultWidth`/`defaultHeight`, `portPattern`, `isContainer`, `ariaShapeLabel`
- `PortPattern` union type: `standard`, `branch-per-case`, `branch-per-outcome`, `branch-per-branch`, `container`, `source-only`, `sink-only`
- `VISUAL_REGISTRY` — frozen `ReadonlyMap` covering all 20 kinds + sentinels
- `getVisualSpec(kind)` — lookup with `task-card` fallback

### Consolidation (7 files modified)

- `workflow-graph-conversions.ts`: Deleted 6 hardcoded `*_KINDS` Sets, re-exports `categorizeKind` from `kind-metadata`, wires `visualClass`, `displayName`, `ariaShapeLabel` into `CanvasTaskNodeData` via `toReactFlowElements()`
- `useWorkflowTopology.ts`: Deleted 6 hardcoded Sets + inline `categorizeKind`, imports from `kind-metadata`
- `topologyFromTasks.ts`: Deleted 6 enum-based Sets + inline `categorizeKind`, imports from `kind-metadata`
- `CanvasTaskNode.tsx`: Added `data-visual-class` and `data-task-kind` attributes, replaced `formatKindLabel` with `data.displayName`, enhanced ARIA labels to include shape names, deleted `formatKindLabel()`
- `index.ts`: Exports `categorizeKind`, `kindToDisplayName`, `VisualClass`, `TaskTypeVisualSpec`, `PortPattern`, `getVisualSpec`, `VISUAL_REGISTRY`

### Test Infrastructure

- 26 new unit tests (13 for `kind-metadata`, 13 for `task-type-visual-registry`) — exhaustive kind coverage, drift fixes, immutability, fallback behavior
- `createMultiKindTestWorkflow()` E2E fixture spanning 5 visual classes
- `workflow-canvas.ts` E2E helper: `navigateToVisualEditor()`, `getCanvasNode()`, `getCanvasNodeByKind()`, `getNodeVisualClass()`
- `workflow-node-shapes.spec.ts` — 9 interactive E2E tests for data attributes and ARIA labels

### Design Decisions

- **DD-1**: Client-side registry (not proto extension) — avoids cross-cutting Go/Java backend changes; promotion to proto is a future mechanical lift
- **DD-2**: 8 visual classes (not 10) — collapsed `service-card`/`data-card` into `task-card` per Hick's Law; category color already differentiates these
- **DD-3**: Consolidate into `kind-metadata.ts`, don't add a third system — delete all 3 duplicates
- **DD-4**: Align with proto sidecar values — `validate` = `data`, `wait` = `control_flow`
- **DD-5**: Port patterns are type-level descriptions — T02 renders the actual handles

## Benefits

- **Single source of truth**: One canonical module for kind → category and kind → displayName, replacing 3 drifted duplicates
- **Correct classifications**: `validate` and `wait` now match their proto sidecar definitions
- **Proper display names**: Canvas badges show "Agent Call" instead of "agent call", "LLM Call" instead of "llm call"
- **Shape foundation**: T02 can read `getVisualSpec(kind).visualClass` to render diamonds, bars, circles, octagons without any additional data plumbing
- **Testability**: `data-visual-class` and `data-task-kind` attributes enable CSS targeting and E2E assertions
- **Accessibility**: ARIA labels now include shape descriptions (e.g., "diamond shape") for screen reader users

## Impact

- **SDK consumers**: New public exports (`categorizeKind`, `kindToDisplayName`, `VisualClass`, `getVisualSpec`) — platform builders can use these for custom workflow renderers
- **Visual change**: `validate` nodes change from orange (governance) to green (data); `wait` nodes change from yellow (event) to blue (control_flow) — both now correct per proto/sidecar
- **Badge text change**: All kind badges now show proper title-cased display names from the sidecar registry
- **Zero regressions**: All 153 existing workflow tests pass unchanged

## Related Work

- Predecessor: Research report in `20260523.01.workflow-ux-overhaul`
- Next: T02 (NodeShell Component — SVG shape rendering based on this registry)
- Future: Promote `node_shape`/`port_mode` to proto sidecar YAMLs when third-party renderers need server-driven visual specs

---

**Status**: Production Ready
**Timeline**: 1 session (~1 hour implementation)
