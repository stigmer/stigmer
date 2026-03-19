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
**Current Task**: Task 2 — Create `useExecutionUsage` hook
**Status**: In Progress

## Session Progress (2026-03-19)

### Completed
- **Task 1 (P0): Server-side usage merge fix** — DONE
  - Fixed in both Go (OSS) and Java (Cloud) servers
  - 4 files changed across 2 repos: `update_status.go`, `update_status_impl.go`, `AgentExecutionUpdateStatusHandler.java`, `UpdateExecutionStatusActivityImpl.java`
  - Added merge logic for 3 fields: `usage`, `context_info`, `resolved_context` (replace-if-present semantics)
  - Updated log statements in all 4 files to include `has_usage`, `has_context_info`, `has_resolved_context`
  - Go compiles cleanly; Java compiles cleanly (pre-existing errors in unrelated files)

### Decisions Made
- Scope expanded: fix `context_info` and `resolved_context` alongside `usage` (same gap, same pattern)
- Java cloud server fixed in same pass as Go OSS server
- Design decision 001 (usage-merge-gap-root-cause) documented during planning

### Pre-existing Inconsistencies Found (Not Fixed)
- Both gRPC handlers merge `artifacts`, but both Temporal activities skip `artifacts`
- Both Temporal activities set `StatusAudit.UpdatedAt`, but both gRPC handlers do not

## Next Steps
1. **Task 2**: Create `useExecutionUsage` hook in `sdk/react/src/execution/useExecutionUsage.ts`
2. **Task 3**: Create `ExecutionCostSummary` component in `sdk/react/src/execution/ExecutionCostSummary.tsx`
3. **Task 4**: Export, Console integration, end-to-end verification

## Context for Resume
- The 4 open questions from T01_0_plan.md are still unresolved (sub-agent breakdown display, number formatting, per-call metrics exposure)
- The server-side fix is committed but not yet validated with a live agent execution
- Tasks 2-4 are purely frontend (TypeScript/React) — no more backend work needed

## Quick Commands

After loading context:
- "Continue with Task 2" - Start the useExecutionUsage hook
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
