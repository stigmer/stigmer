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
- **Last Session**: May 16, 2026 — Phase 4: Plan/Agent Interaction Mode
- **Active Task**: Phase 4 implemented (InteractionMode enum, per-execution mode on ExecutionConfig, both harness enforcement, SDK mode picker, client app wiring, integration test). Ready to commit.
- **Branch**: `feat/bring-workflows-to-foreground`

## Session Progress (May 16, 2026 — Session 6: Phase 4 Plan/Agent Mode)

### Phase 4 Deliverables (implemented)

1. **Proto contract** — `InteractionMode` enum (UNSPECIFIED, AGENT, PLAN) in `agentexecution/v1/enum.proto`, `interaction_mode` field on `ExecutionConfig` in `spec.proto`. Mode lives on spec only (not status) — clean DDD separation.

2. **cursor-runner enforcement** — `prompt-builder.ts` injects plan mode directive (`<interaction_mode>` section) at the start of all prompt variants (enhanced, continuation, HITL). Best-effort via system prompt since @cursor/sdk has no mode parameter.

3. **agent-runner enforcement** — `create_deep_agent()` in `agent.py` filters platform tools to read-only set (`read, ls, glob, grep, search`) in Plan mode + injects system prompt prefix. Tool-level enforcement.

4. **React SDK** — `InteractionModePicker` (segmented control: Agent | Plan), `InteractionModeBadge` (shows "Plan" badge for non-default mode), wired into `SessionComposer` + `ComposerToolbar`, `SessionComposerSubmitContext.interactionMode` field, full data flow through `useCreateAgentExecution` → `useSessionConversation` → `useSessionPageFlow`.

5. **Client apps** (DD-016 parity) — Both web and desktop `SessionPage` wire `interactionMode` state + `showInteractionModePicker` to `SessionComposer`.

6. **Integration test** — `TestAgentExecution_PlanMode` verifies execution completes, spec reflects plan mode, no write tools invoked.

7. **Design decision** — `interaction_mode` lives ONLY on `spec.execution_config` (user input), NOT on status (system output). Eliminates need for backend merge handling in Go/Java UpdateStatus handlers.

### Key Design Decisions

- Per-execution granularity (not per-session) — mirrors Cursor's Shift+Tab behavior
- Plan + Agent only (Ask mode deferred — fuzzy distinction from Plan)
- Cursor harness: best-effort via system prompt (SDK limitation)
- Native harness: enforced via tool filtering

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

1. Plan Phase 5: Admin API reconciliation (MEDIUM priority, depends on Cursor Analytics API maturity)
2. Consider Phase 3b (manual trigger, transcript access) if user feedback warrants it
3. Consider adding CLI `--mode=plan` flag (independent, not blocking)
4. Consider "Build from plan" UX flow (Plan → Agent transition button)

## Context for Resume

- `ContextTracker` uses `inputTokens` as proxy for context size — this is an approximation, not exact
- Drop threshold is 30% — tunable in `context-tracker.ts` via `DROP_RATIO_THRESHOLD`
- `SummarizationCard` distinguishes native vs Cursor by checking `event.model` (empty = inferred)
- `MessageThread.summarizationEvents` is optional — backward compatible, no changes needed for consumers not passing it
- Phase 2 commit `0a5f08c0c` already committed `ContextGauge`, `SummarizationBadge`, `useContextWindow`
- Ink SDK (CLI terminal) does NOT have a context gauge or summarization card equivalent yet

## Quick Commands

After loading context:
- "Plan Phase 5" — Admin API reconciliation
- "Add CLI --mode flag" — CLI support for plan/agent mode
- "Add Build from Plan UX" — Plan-to-Agent transition button

---

*This file provides direct paths to all project resources for quick context loading.*
