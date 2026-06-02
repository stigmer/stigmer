# Wire Visual Registry Dimensions into Async Layout Pipeline

**Date**: May 23, 2026

## Summary

Extracted a canonical `registryNodeDimensions` adapter and wired it into the async layout path (`useWorkflowLayout`), so the auto-layout button now respects per-shape dimensions from the visual registry. Previously, the async path treated all non-sentinel nodes as 220x56 task-cards — diamonds, parallel bars, circles, octagons, and containers were all mis-sized during auto-layout. Also refactored `applyDagreLayout` to use the same adapter, establishing a single source of truth for node dimension resolution.

## Problem Statement

The layout pipeline had a split between sync and async paths:

- **Sync path** (`applyDagreLayout`, used on initial YAML parse): correctly used `getVisualSpec` from the visual registry for per-kind dimensions.
- **Async path** (`useWorkflowLayout`, used by auto-layout button): called with no `getNodeDimensions`, causing all nodes to be sized as flat 220x56 cards.

### Pain Points

- Auto-layout produced overlapping or visually incorrect results for workflows containing `switch_case` (diamond), `fork` (bar), `wait` (circle), `human_input` (octagon), or `for_each`/`try_catch` (container) tasks.
- The dimension lookup logic was duplicated inline in `applyDagreLayout` — 70 lines with two separate sentinel-check + registry-lookup blocks.
- Stale TODO comments ("After T01, wire this to the TaskTypeRegistry") remained in three files despite T01 being completed.

## Solution

Created a module-scope adapter function `registryNodeDimensions` that satisfies the `(node: WorkflowGraphNode) => NodeDimensions` contract, resolving dimensions via the visual registry for all node types including sentinels. Wired it into `useWorkflowLayout()` and refactored `applyDagreLayout` to use it.

## Implementation Details

| File | Change |
|------|--------|
| `layout/registry-dimensions.ts` | **New** — Canonical adapter: sentinel check via `node.id`, then `taskKindToString(node.kind)` → `getVisualSpec()` → `{ width, height }`. Module-scope for referential stability (DD-010). |
| `useWorkflowCanvas.ts` | Passes `{ getNodeDimensions: registryNodeDimensions }` to `useWorkflowLayout()`. Removed stale wiring comment. |
| `layout/apply-dagre-layout.ts` | Replaced inline dimension logic with `registryNodeDimensions` calls. Reduced from 70 → 49 lines, removed 4 direct imports. |
| `layout/index.ts` | Exports `registryNodeDimensions` from the barrel. |
| `workflow/index.ts` | Re-exports `registryNodeDimensions` from the SDK public surface. |
| `layout/types.ts` | Updated JSDoc (removed stale TODO). |
| `layout/use-workflow-layout.ts` | Updated JSDoc (removed stale TODO). |
| `layout/__tests__/registry-dimensions.test.ts` | **New** — 18 unit tests covering sentinels, task-cards, diamonds, bars, circles, octagons, containers, and unknown-kind fallback. |

### Key Design Choices

- **Module-scope function** — No closure over React state; referentially stable without `useCallback` wrapping. Satisfies DD-010 (reference stability) by construction.
- **Sentinel uniformity** — `SENTINEL_NODE_WIDTH/HEIGHT` constants and the registry's `terminal-pill` spec use identical values (100x36); the adapter routes sentinels through the registry uniformly.
- **DRY principle** — Single source of truth for "how do we get dimensions for a graph node" — both sync and async paths now delegate to the same function.

## Benefits

- Auto-layout now correctly sizes all 8 visual classes — no more 220x56 squished diamonds or invisible 32px-tall bars.
- Reduced code duplication (21 lines of inline logic consolidated into 1 function call per site).
- Removed 3 stale TODO comments that were creating confusion about wiring status.
- SDK consumers can import `registryNodeDimensions` to build custom dimension providers that extend the registry.

## Impact

- **SDK users** (`@stigmer/react`): `registryNodeDimensions` is now exported as a public utility.
- **Workflow editor UX**: Auto-layout button produces visually correct results for complex workflows.
- **Maintainability**: Future registry changes (new visual classes, dimension tweaks) automatically propagate to both sync and async layout paths.

## Related Work

- T01 (Task Type Visual Registry) — created `getVisualSpec` and the registry data
- T03 (ELK Layout Pipeline) — created `useWorkflowLayout` with the `getNodeDimensions` extension point
- T03 deferred wiring checkpoint: `_projects/2026-05/20260523.02.workflow-ux-implementation/checkpoints/t03-deferred-wiring.md` (Task 1 — now resolved)

---

**Status**: ✅ Production Ready
**Timeline**: ~15 minutes implementation
