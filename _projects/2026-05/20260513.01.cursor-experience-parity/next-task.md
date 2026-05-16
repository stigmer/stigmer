# Next Task: 20260513.01.cursor-experience-parity

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260513.01.cursor-experience-parity

**Description**: Implement usage tracking, context window visibility, chat summarization, and Cursor-like UX features based on deep research findings from three ChatGPT Deep Research reports.
**Goal**: Close the UX gap between Stigmer and Cursor IDE for early adopters: fix $0.00 usage for Cursor sessions, add context window telemetry, implement active chat summarization, and add Plan/Ask mode.
**Tech Stack**: TypeScript (cursor-runner), Java (stigmer-service), Python (agent-runner), Protobuf (protos), React (SDK)
**Components**: cursor-runner, agent-runner, stigmer-service, React SDK, protos (session/execution/billing), Planton usage dashboard

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260513.01.cursor-experience-parity/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current State

- **Status**: In Progress
- **Last Session**: May 16, 2026 — Phase 2: Context Window Visibility
- **Active Task**: Phase 2 implemented. Needs commit, push, cloud commit.
- **Branch**: `feat/bring-workflows-to-foreground`

## Session Progress (May 16, 2026 — Session 4: Context Window Visibility)

### Critical Gap Discovered & Fixed

Neither Go OSS nor Java Cloud `UpdateStatus` handler merged `runner_usage` or `runner_id` from incoming status updates. Phase 1's `UsageAccumulator` data was silently dropped by both servers. Fixed in both:
- `update_status.go` — added `RunnerUsage` and `RunnerId` merge
- `AgentExecutionUpdateStatusHandler.java` — same fix

### Phase 2 Deliverables (implemented)

1. **`useContextWindow` data hook** (`sdk/react/src/execution/useContextWindow.ts`)
   - Extracts `ContextInfo` from execution status
   - Derives health state (healthy/warning/critical) per proto thresholds
   - Maps summarization events to UI-friendly views
   - Graceful empty return for Cursor harness (no `context_info`)

2. **`ContextGauge` styled component** (`sdk/react/src/execution/ContextGauge.tsx`)
   - Full mode: progress bar + threshold marker + token counts + health indicator + summarization summary
   - Compact mode: thin bar + percentage
   - `--stgm-*` tokens (success/warning/destructive), `role="meter"` accessibility
   - Returns `null` when `context_info` absent

3. **`SummarizationBadge` styled component** (`sdk/react/src/execution/SummarizationBadge.tsx`)
   - Collapsible event history (icon + count → expanded event cards)
   - Each event: tokens before/after, compression ratio, duration, model, cost

4. **Console wiring** (DD-016 parity — both client apps updated)
   - `client-apps/web/src/domain/session/SessionPage.tsx` — ContextGauge above UsageWidget in sidebar
   - `client-apps/desktop/src/pages/SessionPage.tsx` — identical wiring

5. **Tests** (`sdk/react/src/execution/__tests__/useContextWindow.test.ts`)
   - 9 tests: null/empty states, health derivation, threshold detection, event mapping, ref stability
   - All passing

### Changes (uncommitted)

**stigmer OSS** (this session):
- `backend/services/stigmer-server/.../update_status.go` — runner_usage merge fix
- `sdk/react/src/execution/useContextWindow.ts` — new hook
- `sdk/react/src/execution/ContextGauge.tsx` — new component
- `sdk/react/src/execution/SummarizationBadge.tsx` — new component
- `sdk/react/src/execution/__tests__/useContextWindow.test.ts` — tests
- `sdk/react/src/execution/index.ts` — barrel exports
- `sdk/react/src/index.ts` — barrel exports
- `client-apps/web/src/domain/session/SessionPage.tsx` — wiring
- `client-apps/desktop/src/pages/SessionPage.tsx` — wiring

**stigmer-cloud** (this session):
- `AgentExecutionUpdateStatusHandler.java` — runner_usage merge fix

### Previous Sessions

- **Session 3** (May 13): Phase 1 Usage MVP — UsageAccumulator, harness identity, billable amount fixes
- **Session 2** (`e090a92b7`): Server-reported deployment mode (getServerInfo RPC)
- **Session 1** (`2ba7abaf9`): Web-desktop feature parity fixes

## Next Steps

1. Commit and push Phase 2 OSS changes
2. Commit and push Phase 2 cloud changes (runner_usage merge in Java handler)
3. Phase 1 OSS changes still need commit (cursor-runner files)
4. Plan Phase 3: Admin API reconciliation OR Plan/Ask mode toggle

## Context for Resume

- `ContextInfo` is field 14 on `AgentExecutionStatus`, defined in `context.proto`
- Native agent-runner already populates `context_info` (initialize, on_token_count_updated, on_summarization_complete)
- Both Go and Java handlers now merge `context_info` AND `runner_usage`
- `useContextWindow` derives health thresholds: 0-70% healthy, 70-90% warning, 90%+ critical
- `ContextGauge` returns `null` for Cursor harness (no `context_info` available — Cursor manages context internally)
- SDK exports follow DD-001 (SDK-first), DD-003 (headless-first), DD-016 (client-app parity)
- Ink SDK (CLI terminal) has its own `UsageWidget` but does NOT yet have a context gauge equivalent

## Quick Commands

After loading context:
- "Commit Phase 2 changes" — Selective commit for context window visibility work
- "Commit cloud changes" — Java handler fix in stigmer-cloud
- "Plan Phase 3" — Admin API reconciliation or Plan/Ask mode

---

*This file provides direct paths to all project resources for quick context loading.*
