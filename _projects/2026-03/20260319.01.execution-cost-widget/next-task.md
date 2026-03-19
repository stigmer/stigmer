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
**Current Task**: All tasks complete
**Status**: Complete
**Last Session**: 2026-03-19 — Clickable file paths + Read tool simplification (Session 6)

## Session Progress (2026-03-19, Session 6)

### Completed — Clickable File Paths + Read Tool Simplification
- **`file-path-resolver.ts`** — Pure utility: `classifyPath`, `resolveGitBrowseUrl`, `resolvePathAction`
- **`FilePathContext.tsx`** — React context for workspace entries and click callback
- **`FilePathLink.tsx`** — Interactive component: git paths → `<a>` (opens GitHub), local/platform → `<button>` (copies to clipboard)
- **`MessageThread.tsx`** — Accepts `workspaceEntries` prop, wraps with `FilePathContext.Provider`
- **`ToolCallItem.tsx`** — Completed/skipped Read items render as non-expandable rows with `FilePathLink`
- **`ToolCallDetail.tsx`** — Read mode removes content block; write/edit/delete modes use `FilePathLink`
- **`ApprovalCard.tsx`** — `FileArgsPreview` uses `FilePathLink`
- **Barrel exports** — `FilePathLink`, `FilePathContext`, `classifyPath`, `resolveGitBrowseUrl`, `resolvePathAction` + types exported from `@stigmer/react`
- **Console wiring** — `SessionPage.tsx` passes `conv.workspaceEntries` to `MessageThread`

### Decisions Made (Session 6)
- Non-expandable Read items use `<div>` to avoid nested interactive element violations
- Git paths resolve to GitHub blob URLs; local/platform paths fall back to copy-to-clipboard
- Platform `.stigmer/` paths are classified separately for future extensibility
- `onFilePathClick` callback enables platform builders to override default behavior

## Session Progress (2026-03-19, Session 5)

### Completed
- **Barrel export promotion** — DONE
  - Added `formatCost` and `formatTokenCount` to `sdk/react/src/execution/index.ts` barrel exports
  - Matches existing `formatDuration` co-export pattern from `ToolCallDetail`
  - Platform builders can now `import { formatCost, formatTokenCount } from '@stigmer/react'`
  - Commit: `75cf8b05` on `feat/add-customize-ui`

### Decisions Made (Session 5)
- Promote formatters to barrel exports — consistent with `formatDuration` precedent, enables headless-first usage of `useExecutionUsage` without `ExecutionCostSummary`

## Session Progress (2026-03-19, Session 4)

### Completed
- **Task 4: Console integration** — DONE
  - Added `ExecutionCostSummary` to `SessionPage.tsx` sidebar alongside `ExecutionProgress`
  - Separate card with same styling pattern (`rounded-lg border border-border bg-card p-3`)
  - Updated sidebar `aria-label` from `"Execution progress"` to `"Execution details"`
  - Reuses existing `displayExecution` variable — zero new data plumbing

### Decisions Made (Session 4)
- Separate cards for progress and cost (semantically distinct regions)
- Progress above, cost below (progressive disclosure: status first, metrics second)
- Accepted brief empty card during initial stream startup (~1-2s artifact)
- Updated sidebar aria-label to reflect composite content

### Previous Sessions
- **Session 3**: Task 3 (ExecutionCostSummary component) — DONE, 26 tests
- **Session 2**: Task 2 (useExecutionUsage hook) — DONE, 19 tests
- **Session 1**: Task 1 (server-side usage merge fix, Go + Java) — DONE, 4 files across 2 repos

### Pre-existing Inconsistencies Found (Not Fixed)
- Both gRPC handlers merge `artifacts`, but both Temporal activities skip `artifacts`
- Both Temporal activities set `StatusAudit.UpdatedAt`, but both gRPC handlers do not

## Project Summary

All 4 tasks complete across 4 sessions:

| Task | Description | Session | Key Artifacts |
|------|-------------|---------|---------------|
| 1 | Server-side usage merge fix | 1 | Go gRPC handlers + Java Temporal activities (2 repos) |
| 2 | `useExecutionUsage` hook | 2 | `sdk/react/src/execution/useExecutionUsage.ts` (19 tests) |
| 3 | `ExecutionCostSummary` component | 3 | `sdk/react/src/execution/ExecutionCostSummary.tsx` (26 tests) |
| 4 | Console integration | 4 | `client-apps/web/src/app/sessions/[id]/SessionPage.tsx` |

## Remaining Work

- End-to-end verification: run a full agent execution and confirm live cost updates stream correctly in the Console sidebar

## Quick Commands

After loading context:
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
