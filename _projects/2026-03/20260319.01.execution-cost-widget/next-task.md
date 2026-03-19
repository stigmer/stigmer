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
**Current Task**: Task 3 — Create `ExecutionCostSummary` component
**Status**: In Progress

## Session Progress (2026-03-19, Session 2)

### Completed
- **Task 2: Create `useExecutionUsage` hook** — DONE
  - Created `sdk/react/src/execution/useExecutionUsage.ts`
  - `aggregateUsage()` pure function: sums UsageMetrics across main agent + sub-agents, merges modelBreakdown by model+provider key, concatenates llmCalls sorted by timestamp
  - `useExecutionUsage()` hook: thin `useMemo` wrapper returning `UseExecutionUsageReturn`
  - Uses proto types directly via `create(UsageMetricsSchema)` and `create(ModelUsageSchema)` — zero custom data interfaces, zero field duplication
  - `UseExecutionUsageReturn` wraps `UsageMetrics | null` with aggregation metadata (`hasSubAgentUsage`, `subAgentUsageCount`)
  - Short-circuits: returns main agent's UsageMetrics directly when no sub-agents have usage (no allocation)
  - Handles `toolResultCharsTruncated` as `bigint` (matches `int64` proto field)
  - Barrel exports added to `sdk/react/src/execution/index.ts` and `sdk/react/src/index.ts`
  - 19 tests (15 pure function + 4 hook) — all passing
  - Created `sdk/react/src/execution/__tests__/useExecutionUsage.test.tsx`

### Decisions Made
- Use proto types directly instead of custom data interfaces (consistent with all existing hooks)
- Extract `aggregateUsage()` as a standalone pure function for testability and reuse
- Naming: `UseExecutionUsageReturn` (not `ExecutionUsageSummary` which already exists in `io.proto` for session-level usage reports)
- `llmCalls` sorted by `timestamp` (not `sequence`) because sequence numbers overlap across agents

### Previous Session (Session 1)
- **Task 1 (P0): Server-side usage merge fix** — DONE
  - Fixed in both Go (OSS) and Java (Cloud) servers
  - 4 files changed across 2 repos
  - Added merge logic for `usage`, `context_info`, `resolved_context`

### Pre-existing Inconsistencies Found (Not Fixed)
- Both gRPC handlers merge `artifacts`, but both Temporal activities skip `artifacts`
- Both Temporal activities set `StatusAudit.UpdatedAt`, but both gRPC handlers do not

## Next Steps
1. **Task 3**: Create `ExecutionCostSummary` component in `sdk/react/src/execution/ExecutionCostSummary.tsx`
2. **Task 4**: Export, Console integration, end-to-end verification

## Context for Resume
- The 4 open questions from T01_0_plan.md are still unresolved (sub-agent breakdown display, number formatting, per-call metrics exposure)
- The server-side fix is committed but not yet validated with a live agent execution
- Task 3 is purely frontend — the hook (`useExecutionUsage`) provides the data layer; the component needs to consume it and render a styled widget using `@stigmer/theme` tokens
- Task 2's plan file at `/Users/suresh/.cursor/plans/useexecutionusage_hook_d5e7d4ac.plan.md` documents the full design including architecture diagrams

## Quick Commands

After loading context:
- "Continue with Task 2" - Start the useExecutionUsage hook
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
