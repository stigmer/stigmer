# Replace Sidebar Widgets with ExecutionProgress

**Date**: March 18, 2026

## Summary

Deleted three premature sidebar widgets (`ExecutionSummary`, `ContextWindowMeter`, `ExecutionDetails`) and their shared formatter module, replacing them with a single `ExecutionProgress` component that shows execution phase and todo/planning items. Follows the "create as we get usage" principle -- metrics and context-window widgets will be re-added when their data is consistently populated.

## Problem Statement

The session page right sidebar contained widgets built speculatively during the session-page-redesign project. They displayed metrics (model, tokens, cost, context window utilization) that were rarely populated by the backend, resulting in a widget that showed only "Completed" with no other useful information.

### Pain Points

- `ExecutionSummary` rendered mostly empty -- model/tokens/cost data wasn't populated, so users saw only the phase badge
- `ContextWindowMeter` required context management to be active, which isn't the common case yet
- `ExecutionDetails` was a monolithic component not used in the SessionPage, kept only for backward compatibility
- `execution-format.ts` contained formatters consumed exclusively by the three deleted components
- The todo/planning items from `AgentExecution.status.todos` (populated by the `write_todos` tool) were not surfaced anywhere in the UI

## Solution

Replaced all sidebar widgets with a single `ExecutionProgress` component in `@stigmer/react` that focuses on two things users actually need to see:

1. **Execution phase** -- always visible via `ExecutionPhaseBadge` (Pending, Running, Completed, Failed, etc.)
2. **Todo checklist** -- when the agent creates todo items, they appear as a compact checklist sorted by activity (in-progress first, then pending, completed, cancelled)

## Implementation Details

### Deleted Files

| File | Lines Removed |
|------|--------------|
| `sdk/react/src/execution/ExecutionSummary.tsx` | 166 |
| `sdk/react/src/execution/ContextWindowMeter.tsx` | 74 |
| `sdk/react/src/execution/ExecutionDetails.tsx` | 398 |
| `sdk/react/src/execution/execution-format.ts` | 91 |

### New Component: `ExecutionProgress`

- **File**: `sdk/react/src/execution/ExecutionProgress.tsx`
- **Package**: `@stigmer/react` (SDK-first -- platform builders embedding execution viewers need this)
- **Props**: `execution: AgentExecution | null`, `className?: string`
- **Behavior**: Composes `ExecutionPhaseBadge` at top, renders `TodoItem[]` from `execution.status.todos` as a compact checklist below
- **Todo status visuals**: Inline SVG icons (no external dependency) with theme-token colors:
  - Pending: empty circle (`text-muted-foreground`)
  - In-progress: pulsing dot (`text-foreground`)
  - Completed: checkmark (`text-success`)
  - Cancelled: x icon with strikethrough text (`text-muted-foreground`)
- **No card chrome**: Consumer controls container styling (consistent with all SDK component patterns)
- **Accessible**: `role="region"`, `role="list"`, `aria-label` attributes

### Modified Files

- `sdk/react/src/execution/index.ts` -- swapped old exports for `ExecutionProgress` + `ExecutionProgressProps`
- `sdk/react/src/index.ts` -- same barrel export update
- `client-apps/web/src/app/sessions/[id]/SessionPage.tsx` -- replaced two-card aside with single `ExecutionProgress` card

## Benefits

- **Clean codebase**: Removed 729 lines of speculative code that provided no real value yet
- **Todo visibility**: Agent planning/task items now surface in the UI for the first time
- **Focused widget**: Shows what users actually care about during execution -- phase and progress
- **Future-ready**: Usage metrics and context window widgets will be added back as dedicated components when the data pipeline consistently populates them

## Impact

- **SDK**: `ExecutionSummary`, `ExecutionDetails`, `ContextWindowMeter`, and `ContextWindowMeterProps`/`ExecutionSummaryProps`/`ExecutionDetailsProps` types removed from `@stigmer/react` exports. `ExecutionProgress` and `ExecutionProgressProps` added.
- **Console**: Session page sidebar simplified to one card
- **Platform builders**: Breaking change for anyone importing the deleted components (acceptable given early stage and no documented adoption)

## Related Work

- Session page redesign (session-page-redesign project, sessions 1-8)
- Todo middleware in agent-runner (`write_todos` tool, `TodoListMiddleware`)
- `AgentExecution.status.todos` proto field (field 9 in `api.proto`)

---

**Status**: Production Ready
