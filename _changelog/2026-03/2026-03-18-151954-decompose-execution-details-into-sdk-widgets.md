# Decompose ExecutionDetails into Standalone SDK Components

**Date**: March 18, 2026

## Summary

Extracted the monolithic `ExecutionDetails` component (596 lines, 7 sections, all file-private) into three standalone, independently usable SDK components — `ExecutionSummary`, `ContextWindowMeter`, and `WorkspaceSummary` — with shared formatting utilities. This decomposition creates the building blocks for the single-canvas session page redesign (Phase 3) while maintaining full backward compatibility with `ExecutionDetails`.

## Problem Statement

`ExecutionDetails` was a single large component that bundled status, model info, token usage, cost, context window utilization, resolved context, and workspace entries into one exhaustive view designed for sidebar layouts. It could not be partially consumed — platform builders who wanted just execution status or just workspace info had to render the entire component.

### Pain Points

- Monolithic structure prevented selective use of individual sections
- All formatters, hooks, guard helpers, and sub-components were file-private — no reuse possible
- The upcoming session page redesign (Phase 3) needs compact, independently placeable widgets — not an all-or-nothing sidebar component
- Workspace entries (a session-level concept) were embedded inside an execution-domain component

## Solution

Decomposed `ExecutionDetails` into three standalone components plus a shared utilities module, following the SDK's established component patterns (headless-first, `--stgm-*` tokens, `cn()` class composition, `readonly` props, conditional rendering).

## Implementation Details

### New Files

- **`execution-format.ts`** — Shared formatters (`formatMs`, `formatTimestamp`, `formatNumber`, `formatCompactNumber`, `formatCost`), the `useElapsedMs` hook, and guard helpers (`hasModelData`, `hasTokenData`). Internal to the execution domain, not exported from barrel.
- **`ExecutionSummary.tsx`** — Compact "at a glance" component showing phase badge + live-ticking duration + model + token counts + estimated cost. Takes `AgentExecution | null` as prop. Conditionally renders rows — omits sections with no data.
- **`ContextWindowMeter.tsx`** — Standalone context window utilization bar with `role="meter"` ARIA support, color-coded thresholds (green/yellow/red), and current/limit token counts.
- **`WorkspaceSummary.tsx`** — Read-only workspace entry list with folder icons and source labels. Placed in `workspace/` domain (not `execution/`) since workspace entries are a session-level concept.

### Refactored Files

- **`ExecutionDetails.tsx`** — Imports shared utilities from `execution-format.ts`, delegates to `ContextWindowMeter` and `WorkspaceSummary` for those sections. Reduced by ~200 lines. Same props interface, same visual output.
- **Barrel exports** — `ExecutionSummary`, `ContextWindowMeter`, `WorkspaceSummary` and their props types added to `execution/index.ts`, `workspace/index.ts`, and root `index.ts`.

### Design Decisions

- **Naming**: Used `ExecutionSummary` (not `ExecutionStatusWidget`) to match the SDK's established convention where suffixes describe UI metaphors. Summary is the natural counterpart to Details.
- **No card chrome**: Components render content without border/background/elevation. The consumer controls the container — this avoids style conflicts when composed inside `ExecutionDetails` (section dividers) vs. the session page (card containers).
- **Domain placement**: `WorkspaceSummary` placed in `workspace/` domain alongside `WorkspaceEditor` and `FolderBrowser`, not in `execution/`.
- **ResolvedContextSection not extracted**: Too niche for standalone use — stays internal to `ExecutionDetails`.

## Benefits

- Platform builders can now import `ExecutionSummary` for compact execution observability without the full `ExecutionDetails` overhead
- `ContextWindowMeter` is independently usable in monitoring dashboards and status bars
- `WorkspaceSummary` provides a read-only workspace display for contexts where editing isn't appropriate
- `ExecutionDetails` is lighter and composes from well-defined building blocks
- Shared formatters eliminate duplication and enable consistent formatting across components
- Phase 3 has clean building blocks ready for the single-canvas session page layout

## Impact

- **SDK surface**: 3 new component exports, 3 new type exports. Zero breaking changes.
- **Platform builders**: New integration options at a finer granularity level
- **Console**: Phase 3 can now compose these widgets into the session page layout
- **Backward compatibility**: `ExecutionDetails` unchanged in behavior and props interface

## Related Work

- Phase 1 (completed): ContextPanel removal — `refactor(web): remove ContextPanel right sidebar from Console layout`
- Phase 3 (next): Redesign SessionPage layout with inline widgets
- Phase 4 (future): Theme token alignment

---

**Status**: Production Ready
**Timeline**: Phase 2 of 4 in the session page single-canvas redesign
