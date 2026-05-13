# Session Notes: 2026-05-13 — T09: Workflow Execution Viewer

## Accomplishments

- **T09 COMPLETE** — Built the full Workflow Execution Viewer following SDK-first architecture (DD-001): event store, data hooks, behavior hooks, styled components, and thin console page shells
- Established streaming infrastructure for workflow execution events using the external store + `useSyncExternalStore` pattern (consistent with DD-009)
- Created 17 new files and modified 4 existing files across `sdk/react/`, `client-apps/web/`

## Implementation (5 Layers, Bottom-Up)

### Layer 0: Event Store — WorkflowExecutionEventStore
- Append-only external store for `useSyncExternalStore`
- Deduplication by sequence_number, ascending order maintenance
- Lazily-computed derived selectors: `getTaskStates()` (Map), `getCostSummary()` (budget aggregation)
- Stream state FSM: idle → connecting → streaming → complete / error / unsupported
- Simpler than ConversationStore — no structural sharing needed (events are immutable)

### Layer 1: SDK Data Hooks (3 new files)
- `useWorkflowExecution` — single execution by ID via `get()`, with cacheKey + not-found handling
- `useWorkflowExecutionEventLog` — paginated event log via `getEventLog()`, cursor-based with type/task filters
- `useWorkflowExecutionArtifacts` — artifacts via `artifact.listByExecution()`

### Layer 2: SDK Behavior Hooks (2 new files)
- `useWorkflowExecutionEventStream` — live `subscribeEvents` for running executions, batch `getEventLog` for terminal executions, UNIMPLEMENTED graceful fallback
- `useWorkflowExecutionActions` — cancel/terminate/pause/resume/recover/submitApproval with loading/error state

### Layer 3: SDK Styled Components (8 new files)
- `WorkflowExecutionViewer` — top-level composed component (two-region layout)
- `WorkflowExecutionHeader` — phase badge, name, duration, cost, contextual action buttons
- `WorkflowExecutionTimeline` — scrollable event list with auto-scroll via IntersectionObserver sentinel
- `WorkflowExecutionTimelineEvent` — per-event-type renderers for all 18 event types (execution/task/agent/approval/budget/signal/artifact)
- `WorkflowExecutionApprovalCard` — inline approval UI with approve/reject + comment
- `WorkflowExecutionTaskPanel` — sidebar task status list with status indicators
- `WorkflowExecutionCostPanel` — budget consumption gauges (cost + tokens)
- `WorkflowExecutionArtifactPanel` — artifact list with download via `getDownloadUrl`

### Layer 4: Console Pages (2 new files + 1 modified)
- Route: `/workflows/executions/[id]/page.tsx`
- Domain: `WorkflowExecutionDetailPage.tsx` — thin shell wiring `onNavigateToAgentExecution` to Next.js router
- Updated: `WorkflowExecutionListPage.tsx` — execution rows now clickable with keyboard support

### Layer 5: Barrel Exports
- `sdk/react/src/workflow/index.ts` — all new hooks and components exported
- `sdk/react/src/index.ts` — root barrel updated with all T09 public API

## Decisions Made

1. **DD-T09-001: Two-region layout** — timeline + sidebar (not three-pane). Follows session page pattern, avoids premature graph complexity.
2. **DD-T09-002: No rAF coalescing** — workflow events are low-frequency. Direct `startTransition` + store append is sufficient.
3. **DD-T09-003: Agent drill-down via navigation callback** — keeps component scope bounded, leverages existing agent execution UI.
4. **DD-T09-004: Append-only event store** — events are immutable, no structural sharing needed per-event. Derived selectors are lazily memoized.
5. **BigInt compatibility** — used `BigInt(0)` instead of `0n` literals for ES target compatibility with client-apps/web tsconfig.

## Key Code Changes

| File | Change |
|------|--------|
| `sdk/react/src/internal/store/workflow-execution-event-store.ts` | New event store with derived selectors |
| `sdk/react/src/workflow/useWorkflowExecution.ts` | New data hook |
| `sdk/react/src/workflow/useWorkflowExecutionEventLog.ts` | New data hook |
| `sdk/react/src/workflow/useWorkflowExecutionArtifacts.ts` | New data hook |
| `sdk/react/src/workflow/useWorkflowExecutionEventStream.ts` | New behavior hook |
| `sdk/react/src/workflow/useWorkflowExecutionActions.ts` | New behavior hook |
| `sdk/react/src/workflow/WorkflowExecutionViewer.tsx` | New composed component |
| `sdk/react/src/workflow/WorkflowExecutionHeader.tsx` | New component |
| `sdk/react/src/workflow/WorkflowExecutionTimeline.tsx` | New component |
| `sdk/react/src/workflow/WorkflowExecutionTimelineEvent.tsx` | New component (18 event renderers) |
| `sdk/react/src/workflow/WorkflowExecutionApprovalCard.tsx` | New component |
| `sdk/react/src/workflow/WorkflowExecutionTaskPanel.tsx` | New component |
| `sdk/react/src/workflow/WorkflowExecutionCostPanel.tsx` | New component |
| `sdk/react/src/workflow/WorkflowExecutionArtifactPanel.tsx` | New component |
| `client-apps/web/src/app/workflows/executions/[id]/page.tsx` | New route |
| `client-apps/web/src/domain/workflow/WorkflowExecutionDetailPage.tsx` | New page |
| `client-apps/web/src/domain/workflow/WorkflowExecutionListPage.tsx` | Clickable rows |
| `sdk/react/src/workflow/index.ts` | Barrel exports |
| `sdk/react/src/index.ts` | Root barrel exports |
| `sdk/react/src/internal/store/index.ts` | Store barrel exports |

## Open Questions

- Backend implementation of `subscribeEvents` and `getEventLog` RPCs (T13) — viewer handles UNIMPLEMENTED gracefully
- Backend implementation of `submitApproval` forwarding — UI is ready, action will surface UNIMPLEMENTED error
- `getDownloadUrl` for artifacts — panel built, falls back to "download not available"
- Workflow YAML export still deferred — no `serializeWorkflowYaml` exists

## Verification

- `tsc --noEmit` passes: sdk/react, sdk/typescript, client-apps/web
- Zero linter errors on all new/modified files

## Next Session Plan

- **T10: YAML Editor with Graph Preview** or **T13: Backend Implementation** (interleave if needed for real data)
- Remaining Phase 1: T11 (Run from UI), T12 (CLI Commands), T14 (Dashboard Widgets)
