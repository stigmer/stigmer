# Workflow Execution Viewer — The Hero Feature

**Date**: May 13, 2026

## Summary

Built the complete Workflow Execution Viewer as a layered SDK-first feature, delivering real-time event streaming, task status tracking, budget monitoring, artifact management, approval handling, and full execution lifecycle controls. This is the first UI surface that makes workflow executions observable — transforming them from invisible backend processes into a live, interactive experience.

## Problem Statement

Workflow executions were completely invisible in the product. After T08 added workflow list and detail pages, users could see that workflows *exist*, but had zero visibility into what happens when a workflow *runs*. There was no way to:

- Watch task progression in real-time
- See which tasks completed, failed, or are waiting for approval
- Monitor cost and token consumption against budgets
- View artifacts produced by execution tasks
- Take action on pending approvals
- Cancel, pause, or recover executions

### Pain Points

- Workflow executions were black boxes — users had to check Temporal directly
- No timeline view for the event stream defined in T06
- No UI consumption of the artifact store defined in T07
- No approval handling at the workflow level
- No budget visibility despite budget primitives from T05

## Solution

A five-layer SDK-first implementation following DD-001 (build in `@stigmer/react` first, consume from console second):

1. **Event Store** — append-only external store with derived selectors for task states and cost
2. **Data Hooks** — fetch execution, event log (paginated), and artifacts
3. **Behavior Hooks** — live event streaming with reconnection, execution lifecycle actions
4. **Styled Components** — timeline, task panel, cost panel, artifact panel, approval card, header, and composed viewer
5. **Console Pages** — thin route shell and clickable execution list

## Implementation Details

### WorkflowExecutionEventStore (internal)

Framework-agnostic store implementing `useSyncExternalStore` contract. Append-only event accumulation with deduplication by sequence_number. Lazily-computed derived selectors:

- `getTaskStates()` — walks events once to build `Map<taskName, DerivedTaskState>` with status, kind, duration, cost, tokens, child execution ID
- `getCostSummary()` — prefers latest `budget_checkpoint` event, falls back to `execution_completed` summary, then aggregates `task_completed` costs

Design decision: no rAF coalescing (unlike agent streaming). Workflow events are low-frequency (task transitions over seconds/minutes). Direct `startTransition` + store append is sufficient.

### Streaming Architecture

- **Running executions**: `subscribeEvents` server-streaming RPC with replay+live-tail via `after_sequence`. Reconnects from last received sequence on disconnect.
- **Terminal executions**: Batch loads full event log via paginated `getEventLog` calls (500 events per page).
- **UNIMPLEMENTED graceful fallback**: If backend hasn't implemented `subscribeEvents` yet (T13 pending), surfaces `streamState: 'unsupported'` instead of erroring.

### Timeline Event Renderers

18 event types each get a dedicated renderer with appropriate icons, colors, and metadata:

- Execution lifecycle: started (task count), completed (duration/cost/tokens), failed (error + failed task), paused/resumed/cancelled/terminated
- Task lifecycle: started (kind badge, attempt number), completed (duration/cost/tokens), failed (error, will-retry indicator), skipped (reason), retrying (delay)
- Agent call: started (agent slug, child execution link), progress (messages/tools count), completed (duration/cost)
- Approval: requested (prompt, approvers, timeout), resolved (by, comment)
- Budget: checkpoint (consumed/remaining, threshold breach)
- Signals, events, artifacts: informational rows

### Two-Region Layout (DD-T09-001)

Follows the established session page pattern instead of the originally-planned three-pane layout:

- **Main area**: Scrollable event timeline with auto-scroll via IntersectionObserver bottom sentinel
- **Sidebar** (264px): Task status panel, budget gauges, artifact list

The graph view from T15 can be added as a sidebar tab later without restructuring.

## Benefits

- **Observability**: First-ever visibility into workflow execution internals
- **Real-time**: Live event streaming shows task progression as it happens
- **Actionable**: Cancel, pause, resume, recover, and approve from the viewer
- **Embeddable**: All components work identically in third-party dashboards (DD-004)
- **Headless-first**: Data hooks, behavior hooks, and styled components are independently importable (DD-003)
- **Type-safe**: All types from `@stigmer/protos`, zero hand-written duplicates (DD-007)

## Impact

- **Users**: Can now monitor, debug, and control workflow executions from the web console
- **Platform builders**: Can embed `<WorkflowExecutionViewer>` in their own dashboards with a single component
- **Product**: Workflows move from invisible infrastructure to observable, interactive product surface
- **Architecture**: Establishes the event store + derived selector pattern for workflow streaming (complements ConversationStore for agent streaming)

## Related Work

- **T06** (Execution Event Stream Model) — defines the event protos this viewer consumes
- **T07** (Artifact Store) — defines the artifact protos the artifact panel consumes
- **T05** (Budget Primitives) — defines the budget model the cost panel displays
- **T08** (Workflow List/Detail Pages) — the pages that link to this viewer
- **T13** (Backend Implementation) — will wire the RPCs that this viewer calls

---

**Status**: Production Ready (frontend contracts complete; backend RPCs pending T13)
**Timeline**: 1 session
