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
- **Last Session**: May 16, 2026 — Phase 3a: Chat Summarization Visibility
- **Active Task**: Phase 3a implemented (cursor context tracking + inline timeline cards). Phase 3b (manual trigger + transcript access) deferred.
- **Branch**: `feat/bring-workflows-to-foreground`

## Session Progress (May 16, 2026 — Session 5: Phase 3a Chat Summarization)

### Phase 3a Deliverables (implemented)

1. **`ContextTracker` adapter** (`backend/services/cursor-runner/src/adapter/context-tracker.ts`) — NEW
   - Tracks per-turn `inputTokens` from `TurnEndedUpdate.usage`
   - Detects Cursor-managed summarization when input tokens drop >30% between turns
   - Static lookup table of model context windows (Claude, GPT, Gemini, O-series)
   - Produces `ContextInfo` proto with approximate utilization and detected events
   - `SummarizationSource.UNSPECIFIED` for inferred events (vs native's exact source)

2. **Execute-cursor wiring** (`execute-cursor.ts`)
   - `ContextTracker` initialized alongside `UsageAccumulator` after model resolution
   - Fed `inputTokens` in `turn-ended` onDelta handler
   - `status.contextInfo` emitted on every heartbeat and at finalization
   - Cursor sessions now populate `ContextGauge` and `SummarizationBadge`

3. **`SummarizationCard` component** (`sdk/react/src/execution/SummarizationCard.tsx`) — NEW
   - Inline timeline card: "Context compacted" (native) / "Detected context compaction" (Cursor)
   - Tokens before/after, compression ratio, duration/model/cost (native only)
   - `role="status"` accessibility, `--stgm-*` design tokens

4. **`MessageThread` event interleaving** (`sdk/react/src/execution/MessageThread.tsx`)
   - New `"context-compacted"` variant in `ThreadItem` discriminated union
   - `summarizationEvents` prop on `MessageThreadProps`
   - `buildThreadItems` interleaves events chronologically among messages
   - `VirtualizedThread` inherits support automatically

5. **Client app wiring** (web + desktop SessionPage)
   - Both call `useContextWindow(flow.displayExecution)` and pass `summarizationEvents` to `MessageThread`

### Phase 3b (deferred)

- Manual "Summarize now" trigger — needs new RPC path + Graphton signaling
- Full transcript access — message fold logic based on summarization events

### Previous Sessions

- **Session 4** (May 16, earlier): Phase 2 Context Window Visibility — committed as `0a5f08c0c`
- **Session 3** (May 13): Phase 1 Usage MVP — UsageAccumulator, harness identity, billable amount fixes
- **Session 2** (`e090a92b7`): Server-reported deployment mode (getServerInfo RPC)
- **Session 1** (`2ba7abaf9`): Web-desktop feature parity fixes

## Next Steps

1. Phase 1 cursor-runner files still need commit (usage-accumulator.ts, stigmer-client.ts — Phase 1 changes)
2. Cloud runner_usage merge fix still needs commit (AgentExecutionUpdateStatusHandler.java)
3. Plan Phase 4: Plan/Ask mode toggle (MEDIUM priority)
4. Plan Phase 5: Admin API reconciliation (MEDIUM priority, depends on Cursor Analytics API maturity)
5. Consider Phase 3b (manual trigger, transcript access) if user feedback warrants it

## Context for Resume

- `ContextTracker` uses `inputTokens` as proxy for context size — this is an approximation, not exact
- Drop threshold is 30% — tunable in `context-tracker.ts` via `DROP_RATIO_THRESHOLD`
- `SummarizationCard` distinguishes native vs Cursor by checking `event.model` (empty = inferred)
- `MessageThread.summarizationEvents` is optional — backward compatible, no changes needed for consumers not passing it
- Phase 2 commit `0a5f08c0c` already committed `ContextGauge`, `SummarizationBadge`, `useContextWindow`
- Ink SDK (CLI terminal) does NOT have a context gauge or summarization card equivalent yet

## Quick Commands

After loading context:
- "Commit Phase 3 changes" — Selective commit for chat summarization work
- "Commit Phase 1 cursor-runner changes" — Phase 1 usage accumulator files
- "Commit cloud changes" — Java handler fix in stigmer-cloud
- "Plan Phase 4" — Plan/Ask mode toggle

---

*This file provides direct paths to all project resources for quick context loading.*
