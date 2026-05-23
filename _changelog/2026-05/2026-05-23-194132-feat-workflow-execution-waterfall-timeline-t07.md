# Workflow Execution Waterfall Timeline (T07)

**Date**: May 23, 2026

## Summary

Added an Inngest-style horizontal waterfall timeline to the workflow execution viewer, replacing the collapsible event log as the default bottom panel view. Tasks render as positioned bars on a time axis, answering "Why is it slow?" at a glance. The event log is preserved as a secondary tab for detailed audit trail inspection.

## Problem Statement

The execution viewer's bottom panel was a flat chronological event log — useful for debugging but poor for temporal analysis. Users monitoring long-running AI workflows had no visual way to see task durations, identify bottlenecks, understand parallelism, or spot retry patterns without manually reading timestamps and computing deltas.

### Pain Points

- No visual representation of task timing or overlap
- Bottleneck identification required mental math on timestamps
- Parallel task execution was invisible in the flat event list
- Retry patterns (backoff gaps, attempt durations) were buried in event text
- Approval wait times had no visual distinction from execution time
- The bottom panel defaulted to collapsed — effectively hiding the timeline

## Solution

Built a three-layer waterfall timeline following the SDK architecture (DD-001 through DD-003):

1. **Pure derivation** (`derive-waterfall-entries.ts`) — walks the event list once to produce `WaterfallEntry[]` with absolute time positions, retry attempts, agent sub-spans, and approval wait segments
2. **Behavior hook** (`useWaterfallEntries`) — manages live-growing bars via `requestAnimationFrame` during streaming, with referentially stable returns (DD-010)
3. **Styled components** (`waterfall/` module) — `WaterfallTimeline`, `WaterfallRow`, `WaterfallBar`, `WaterfallScale`, `WaterfallTooltip` — all theme-compliant, reduced-motion safe, and `React.memo`'d for streaming performance

Integrated into `WorkflowExecutionViewer` as a tabbed `ExecutionBottomPanel` with Waterfall (default) and Events tabs. Bidirectional selection sync: clicking a bar selects the task in the graph and inspector; selecting a node in the graph scrolls the waterfall.

## Implementation Details

### Architecture

```
events → deriveWaterfallEntries(events, execStartIso)
       → WaterfallEntry[] { taskName, startMs, endMs, status, attempts[], children[], approvalWaitMs }
       → useWaterfallEntries(events, streamState, execStartIso, execDurationMs)
       → { entries, scale, isLive, nowMs }
       → WaterfallTimeline → WaterfallRow → WaterfallBar
```

### Key design decisions

- **Tabs, not replacement** — Waterfall and Event Log coexist per research recommendation ("four coordinated views")
- **Start-time ordering** — entries sorted by `startMs` to show temporal progression naturally
- **Nice-interval scale** — time axis picks aesthetically clean tick intervals (10ms, 50ms, 1s, 5s, 30s, 1m, etc.) that produce at most 12 ticks
- **Graceful degradation** — agent sub-spans (`WaterfallSpan.children`) and retry backoff gaps are architecturally ready but render empty arrays until the runner emits the corresponding events
- **rAF-driven live bars** — running task bars grow in real-time during streaming, snapping to final duration on completion

### Files created

| File | Purpose |
|------|---------|
| `sdk/react/src/workflow/execution/derive-waterfall-entries.ts` | Pure derivation: events → `WaterfallEntry[]` + `WaterfallScale` |
| `sdk/react/src/workflow/execution/useWaterfallEntries.ts` | Behavior hook with rAF live bar growth |
| `sdk/react/src/workflow/waterfall/WaterfallTimeline.tsx` | Main SDK component |
| `sdk/react/src/workflow/waterfall/WaterfallRow.tsx` | Task row with label, duration, cost, bar |
| `sdk/react/src/workflow/waterfall/WaterfallBar.tsx` | Horizontal bar with retry/approval/agent segments |
| `sdk/react/src/workflow/waterfall/WaterfallScale.tsx` | Time axis with nice-interval ticks |
| `sdk/react/src/workflow/waterfall/WaterfallTooltip.tsx` | Hover tooltip with task metrics |
| `sdk/react/src/workflow/waterfall/index.ts` | Module barrel |

### Files modified

| File | Change |
|------|--------|
| `WorkflowExecutionViewer.tsx` | Replaced inline `TimelinePanel` with tabbed `ExecutionBottomPanel` |
| `execution/index.ts` | Added waterfall derivation + hook exports |
| `workflow/index.ts` | Added waterfall public SDK exports |

## Benefits

- **Instant bottleneck identification** — longest bars are immediately visible
- **Parallel execution clarity** — overlapping bars show which tasks ran concurrently
- **Retry pattern visibility** — attempt segments with backoff gaps match AWS Step Functions and Inngest patterns
- **Approval wait distinction** — amber segments within task bars show human wait time separately from execution time
- **Live monitoring** — bars grow in real-time during streaming with rAF animation
- **No breaking changes** — Event Log preserved as a tab; client apps pick up waterfall automatically via SDK

## Impact

- SDK: New public exports (`WaterfallTimeline`, `useWaterfallEntries`, derivation types)
- Web Console: Automatic — consumes `WorkflowExecutionViewer` from `@stigmer/react`
- Desktop: Automatic — same SDK consumption (DD-016 parity verified)
- Backend: Zero changes — waterfall consumes existing event data

## Related Work

- T04: Read-Only Execution Canvas — the graph that the waterfall coordinates with
- T05: Runtime Inspector Panel — the inspector that updates when a waterfall bar is clicked
- T06: Branch and Parallel Execution Highlighting — edge/node overlays that complement the waterfall's temporal view
- `checkpoints/t07-waterfall-backend-followups.md` — 5 backend items that will enrich the waterfall when implemented

---

**Status**: Production Ready
**Tests**: 38 unit tests (derivation + scale), 5 E2E specs
