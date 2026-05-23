# Runtime Execution Inspector Panel (T05)

**Date**: May 23, 2026

## Summary

Implemented the T05 Runtime Inspector Panel for workflow executions: a tabbed sidebar that shows rich per-task detail derived from execution events and status snapshots. Replaced the placeholder stub with a production-ready inspector wired into `WorkflowExecutionViewer`, including deduplicated streaming subscriptions, canonical formatting utilities, and comprehensive test coverage.

## Problem Statement

After T04 delivered the read-only execution canvas, operators could see task status on the graph but had no way to drill into per-task details — inputs, outputs, errors, retries, agent calls, or raw events. The inspector stub only showed the selected task name.

### Pain Points

- No task-level detail view during execution monitoring
- Duplicate gRPC event subscriptions (viewer + graph hook each subscribed independently)
- Inconsistent formatting utilities duplicated across 5 workflow components
- Graph auto-select on failure did not propagate to the viewer's `selectedTaskName`
- Risk of losing deferred ELK/`getNodeDimensions` wiring context between sessions

## Solution

Built a headless-first inspector module (`execution-inspector/`) with pure derivation logic, presentational tab components, and SDK integration into the existing execution viewer layout.

### Architecture

```
WorkflowExecutionViewer (owns execution + event stream)
├── WorkflowExecutionGraph (receives shared taskStates, onAutoSelectTask)
└── ExecutionInspector (deriveTaskDetail → contextual tabs)
```

**Tab visibility** is contextual: Error tab auto-selected on failure; Retries/Agent Call tabs appear only when data exists; Input/Output show graceful empty states until runner populates full `WorkflowTask` data.

## Implementation Details

### Core Derivation (`derive-task-detail.ts`)

Pure function joining `WorkflowExecutionEvent[]` + optional `WorkflowTask` snapshot into `TaskDetail`:
- Summary: timing, cost, tokens, attempt number
- I/O: input/output Structs + artifact links (empty state when runner gap)
- Error: message, retryability, attempt context
- Retries: per-attempt history from `TASK_RETRY_SCHEDULED` / `TASK_FAILED` events
- Agent Call: child execution link, token/cost aggregates
- Event Log: filtered raw events for selected task

44 unit tests cover all 7 statuses, retry histories, agent calls, approvals, and snapshot-vs-event priority.

### Subscription Deduplication

`WorkflowExecutionViewer` now owns the execution fetch and event stream. `useWorkflowExecutionGraph` accepts optional `execution`, `taskStates`, and `onAutoSelectTask` — when provided, skips its own fetch/subscribe path.

### Format Utilities (`format-utils.ts`)

Extracted `formatDuration`, `formatMicroUsd`, `formatTokenCount`, `formatBytes`, `formatTimestamp`, `formatMetaChips` — replaced inline duplicates in 5 files.

### E2E Coverage

`workflow-execution-inspector.spec.ts` — 6 tests: node selection, summary content, deselect empty state, ARIA tab roles, events tab, sidebar width (`w-80`/`lg:w-96`).

### Project Documentation

- `checkpoints/t03-deferred-wiring.md` — ELK worker + `getNodeDimensions` wiring deferred
- `checkpoints/t05-runner-io-followup.md` — backend task to populate full `WorkflowTask` I/O

## Benefits

- Operators can inspect any task without leaving the execution view
- Single event subscription reduces API load and state drift risk
- Pure derivation is testable without React — 65 new unit tests
- Desktop/web parity via SDK-first delivery (no client-app changes)
- Deferred work captured in checkpoints — safe to resume later

## Impact

| Area | Effect |
|------|--------|
| SDK (`@stigmer/react`) | New `ExecutionInspector`, `useExecutionTaskDetail`, `deriveTaskDetail`, format utils exported |
| Web/Desktop | Automatic via `WorkflowExecutionViewer` — wider inspector sidebar |
| Runner | No changes; I/O tabs show empty states until follow-up task |
| E2E | New interactive tier spec + 5 helper functions |

## Related Work

- T04: Read-only execution canvas (`6adb3a366`)
- T03: ELK layout pipeline (deferred wiring in `t03-deferred-wiring.md`)
- Backend follow-up: `t05-runner-io-followup.md`
- Changelog: agent_call env forwarding (`2026-05-23-145540-fix-workflow-agent-call-env-forwarding-and-idempotency.md`)

---

**Status**: ✅ Production Ready (I/O tabs pending runner data population)
**Timeline**: Single session (2026-05-23)
