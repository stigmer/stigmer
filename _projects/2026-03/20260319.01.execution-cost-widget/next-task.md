# Next Task: 20260319.01.execution-cost-widget

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260319.01.execution-cost-widget

**Description**: Add a real-time execution cost/usage widget to the SDK React package that displays token consumption, LLM call metrics, and estimated cost alongside ExecutionProgress. Includes fixing the server-side usage merge gap so cost data streams progressively.
**Goal**: Deliver an ExecutionCostSummary component in @stigmer/react with a useExecutionUsage hook, fix the Go server-side usage merge so cost data flows in real-time during streaming, and integrate the widget into the Console sidebar next to ExecutionProgress.
**Tech Stack**: TypeScript/React (@stigmer/react, @stigmer/sdk, @stigmer/theme), Go (stigmer-server), Protocol Buffers
**Components**: sdk/react (new hook + component), backend/services/stigmer-server (usage merge fix), client-apps/web (Console integration), apis/ (proto validation)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.01.execution-cost-widget/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.01.execution-cost-widget/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.01.execution-cost-widget/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.01.execution-cost-widget/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.01.execution-cost-widget/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.01.execution-cost-widget/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.01.execution-cost-widget/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.01.execution-cost-widget/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.01.execution-cost-widget/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.01.execution-cost-widget/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.01.execution-cost-widget/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.01.execution-cost-widget/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.01.execution-cost-widget/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-19 09:07
**Current Task**: Task 4 — Console integration and end-to-end verification
**Status**: In Progress

## Session Progress (2026-03-19, Session 3)

### Completed
- **Task 3: Create `ExecutionCostSummary` component** — DONE
  - Created `sdk/react/src/execution/ExecutionCostSummary.tsx` (~145 lines)
  - Chromeless styled component following `ExecutionProgress` pattern
  - Internally uses `useExecutionUsage` hook for aggregated data
  - `formatCost()`: `$0.00` / `$0.0042` (4 decimals < $1) / `$1.23` (2 decimals >= $1)
  - `formatTokenCount()`: comma-separated via `Intl.NumberFormat("en-US")`
  - `ModelBreakdown` sub-component: per-model cost table when multiple models
  - `CacheLine` sub-component: conditional cache read/write display
  - `tabular-nums` for stable digit widths during streaming
  - `role="region"` + `aria-label="Execution cost summary"` for accessibility
  - Barrel exports in `sdk/react/src/execution/index.ts` and `sdk/react/src/index.ts`
  - 26 tests (10 formatting + 16 component render) — all passing
  - Created `sdk/react/src/execution/__tests__/ExecutionCostSummary.test.tsx`

### Decisions Made (Session 3)
- Duration metrics excluded from component (single responsibility: cost, not timing)
- Flat layout, no expand/collapse (information density over interactivity)
- Sub-agents: aggregated total with "Includes N sub-agents" annotation
- Model breakdown: inline single-model, per-model cost table for multi-model
- Cost: `$X.XXXX` for < $1, `$X.XX` for >= $1
- Tokens: comma-separated integers (power-user precision)
- No animation libraries (embeddability liability)
- Formatting utilities exported from file for testability, not from barrel (internal API)

### Previous Sessions
- **Session 2**: Task 2 (useExecutionUsage hook) — DONE, 19 tests
- **Session 1**: Task 1 (server-side usage merge fix, Go + Java) — DONE, 4 files across 2 repos

### Pre-existing Inconsistencies Found (Not Fixed)
- Both gRPC handlers merge `artifacts`, but both Temporal activities skip `artifacts`
- Both Temporal activities set `StatusAudit.UpdatedAt`, but both gRPC handlers do not

## Next Steps
1. **Task 4**: Add `<ExecutionCostSummary execution={displayExecution} />` to `SessionPage.tsx` sidebar alongside `ExecutionProgress`
2. **Task 4**: End-to-end verification — run a full agent execution and confirm live cost updates

## Context for Resume
- All 4 open questions from T01_0_plan.md are now resolved through implementation
- Tasks 1-3 are fully complete: server merge fix, data hook, styled component
- Task 4 is purely Console integration — consuming the SDK component in `client-apps/web`
- The integration point is `SessionPage.tsx` sidebar (`<aside>` tag, `w-80`, `flex-col gap-3`)
- The `displayExecution` variable already exists and is used by `ExecutionProgress` — pass the same to `ExecutionCostSummary`
- The component should be wrapped in the same card pattern: `<div className="rounded-lg border border-border bg-card p-3">`

## Quick Commands

After loading context:
- "Continue with Task 4" - Console integration
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
