# Session Notes: 2026-05-23 — T05 Runtime Inspector Panel

## Accomplishments

- **T05 complete**: Replaced `ExecutionInspectorStub` with full tabbed `ExecutionInspector`
- Created `execution-inspector/` module: `deriveTaskDetail` pure function, `useExecutionTaskDetail` hook, 6 tab components
- Extracted canonical `format-utils.ts` (duration, cost, tokens, bytes, timestamps) — deduplicated 5 files
- Lifted event store ownership to `WorkflowExecutionViewer` — eliminated duplicate gRPC subscriptions
- Fixed failed-task auto-select propagation via `onAutoSelectTask` callback
- 44 unit tests for `deriveTaskDetail`, 21 for format utils, 6 E2E inspector tests
- Documented deferred wiring (`t03-deferred-wiring.md`) and runner I/O follow-up (`t05-runner-io-followup.md`)

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Input/Output from `WorkflowTask` snapshot, not events | Proto defines rich I/O on status; events are audit trail |
| Graceful empty states for I/O tabs | Runner only populates 5 fields today — backend follow-up documented |
| Reuse existing `Tabs` component | Full WAI-ARIA compliance already implemented |
| Reuse `CollapsibleCode` + `formatJson` | Avoid new Struct viewer in T05 scope |
| Lift subscriptions to viewer | DD-009 streaming architecture — single owner, pass down |
| Defer ELK worker + `getNodeDimensions` wiring | Captured in checkpoint — pick up when layout work resumes |

## Key Code Changes

| File | Change |
|------|--------|
| `execution-inspector/derive-task-detail.ts` | Pure derivation: summary, I/O, errors, retries, agent calls, approvals, event log |
| `execution-inspector/ExecutionInspector.tsx` | Contextual tab visibility, auto-select Error tab on failure |
| `WorkflowExecutionViewer.tsx` | Owns execution + event stream; passes shared data to graph + inspector |
| `useWorkflowExecutionGraph.ts` | Optional external execution/taskStates; `onAutoSelectTask` once-only |
| `format-utils.ts` | Single source of truth for execution formatting |
| `test/e2e/.../workflow-execution-inspector.spec.ts` | 6 tests: selection, ARIA, tabs, empty state, sidebar width |

## Learnings

- Runner `TaskStatusAccumulator` writes only `taskName`, `status`, `startedAt`, `completedAt`, `error` — inspector I/O tabs need backend follow-up
- Desktop app needs no changes (DD-016) — consumes `WorkflowExecutionViewer` from SDK
- Pre-existing component test failures (`document is not defined`) unrelated to T05

## Open Questions

- When to implement runner I/O population (see `t05-runner-io-followup.md`)
- Whether T06 (branch highlighting) or T08 (contextual picker) is higher priority next

## Next Session Plan

1. Start **T06** (branch/parallel highlighting) or **T08** (contextual task picker)
2. Optionally wire deferred ELK + `getNodeDimensions` when touching layout again
3. Backend: populate full `WorkflowTask` on status updates (unblocks inspector I/O tabs)
