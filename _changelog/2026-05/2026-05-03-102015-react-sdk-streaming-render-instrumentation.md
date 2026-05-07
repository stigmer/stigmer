# React SDK Streaming Render Instrumentation

**Date**: May 3, 2026

## Summary

Added dev-only observability utilities to the `@stigmer/react` SDK that quantify exactly how the streaming render pipeline behaves during live gRPC token streaming. This is Phase 0 (T02) of the React SDK Streaming UX project — the "measure before you optimize" foundation that every subsequent phase validates against.

## Problem Statement

The `@stigmer/react` message thread exhibits flickering, jank, and excessive re-renders during agent execution streaming. Before fixing these issues, we need hard numbers: how many rows re-render per stream tick, whether completed messages re-parse markdown, whether the composer re-renders during streaming, and whether keys are stable across reconciliation boundaries.

### Pain Points

- No visibility into per-component render frequency during streaming
- No way to detect key instability (remounts disguised as updates)
- No measurement of stream event rate or batching characteristics
- No commit-level timing data for the thread render path
- No DOM size tracking for long conversations

## Solution

Six dev-only instrumentation utilities in `sdk/react/src/internal/dev/`, all gated behind `process.env.NODE_ENV !== "production"` so they tree-shake to zero in production builds. Each utility is integrated into the streaming hot path with 1-3 lines of code per component.

## Implementation Details

### New Utilities

| Utility | Purpose |
|---------|---------|
| `useRenderTracer` | Ref-based render counter with shallow prop diff. Logs which props changed (by referential equality) on sampled renders (every 10th). |
| `useKeyStability` | Compares thread item keys across renders. Warns when a key disappears and a new key appears at the same index — the signature of a React remount. |
| `useStreamRate` | Imperative tracker called inside the `for await` stream loop. Tracks tick rate, inter-event intervals (min/avg/max), and message count deltas over a rolling window. Logs a summary on stream completion. |
| `DevProfiler` | Thin wrapper around React's `<Profiler>` API. Logs `actualDuration` and `baseDuration` per commit with sampled output. No-ops in production (React strips Profiler callbacks automatically, plus our dev gate). |
| `useDomNodeCount` | Counts DOM nodes under a container ref via `requestIdleCallback` to avoid blocking renders. Logs periodically. |

### Integration Points (30 lines added across 6 files)

- **`useExecutionStream.ts`**: `streamRate.tick()` on each snapshot, `streamRate.summary()` on stream completion
- **`MessageThread.tsx`**: `useRenderTracer`, `useKeyStability`, `useDomNodeCount`, `<DevProfiler>` wrapping thread content
- **`MessageEntry.tsx`**: `useRenderTracer` on both `MessageEntry` and `AiMessage` (isolates markdown parse cost)
- **`SessionComposer.tsx`**: `useRenderTracer` (proves whether composer re-renders per token)
- **`ToolCallGroup.tsx`**, **`SubAgentSection.tsx`**: `useRenderTracer`

### Design Decisions

- **Sampling over logging every tick**: Stream produces 10-15 ticks/second. All utilities log every 10th event to avoid console flood, plus aggregate summaries on stream completion.
- **Shallow prop diff only**: `Object.is()` referential equality — deep diffing proto objects would be expensive and counterproductive for an instrumentation tool.
- **SDK-internal, not exported**: All utilities live in `internal/dev/` and are not part of the public API barrel (`index.ts`). No additions to the published package surface.
- **Consistent console prefix**: All output uses `[stgm:perf:*]` prefix for grep-ability.

## Benefits

- Every subsequent phase (key fixes, structural sharing store, row-level subscriptions, etc.) can measure before/after with hard numbers
- Key instability warnings surface remount bugs immediately during development
- Stream rate data reveals server-side batching characteristics
- Profiler timing quantifies actual render cost vs theoretical baseline
- DOM counter tracks thread complexity growth in long conversations

## Impact

- **Developers**: Can now open browser console during streaming and see exactly what re-renders, how often, and why
- **SDK consumers**: Zero impact — all instrumentation is tree-shaken from production builds
- **Bundle size**: No production impact; dev utilities add ~2.5KB to dev builds only
- **Existing tests**: All 252 tests pass unchanged; 9 new tests added for `useRenderTracer` and `useKeyStability`

## Related Work

- Project: `_projects/2026-05/20260503.01.react-sdk-streaming-ux`
- Research: `_projects/2026-05/research.react-sdk-streaming-ux-quality/04.report.gpt.md`
- Next phase: T03 (Fix Keys & Pending Reconciliation)

---

**Status**: Production Ready
**Commit**: `39c8e2ee3`
