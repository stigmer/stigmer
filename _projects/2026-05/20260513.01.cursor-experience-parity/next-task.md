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
- **Last Session**: May 17, 2026 — Session 9: Resume Mode Flag + Ink Mode Toggle
- **Active Task**: Both features implemented, tested, verified, and committed.
- **Branch**: `feat/bring-workflows-to-foreground`

## Session Progress (May 17, 2026 — Session 9: Resume Mode Flag + Ink Mode Toggle)

### Deliverables (implemented)

1. **`stigmer resume --mode` flag** — Added `--mode` to `NewResumeCommand` with validation via existing `validateMode()`. Threaded `mode string` through all 4 resume call paths. Added `resolveResumeMode(explicitMode, latestExec)` for auto-inference from last execution's `ExecutionConfig.InteractionMode`. Set `headerInfo.Mode = effectiveMode` which flows to header display and Ink subprocess.

2. **Ink Ctrl+T mode toggle** — Converted static `mode` prop to `useState<InteractionMode>` in `SessionView`. Added Ctrl+T handler alongside existing Ctrl+O. Mode indicator always visible (yellow for Plan, cyan for Agent). `FollowUpInput` hint line shows what Ctrl+T will switch to.

3. **5 unit tests** — Table-driven `TestResolveResumeMode` covering explicit overrides, auto-inference from Plan execution, Agent/unspecified passthrough, and nil config.

4. **Barrel export** — `InteractionMode` type exported from `@stigmer/ink` index.

### Key Design Decisions

- Auto-infer mode from last execution (not always default to agent) — preserves user intent on resume
- Ctrl+T chosen for toggle (T for Toggle) — pairs with existing Ctrl+O, no terminal conflicts
- Mode is always passed explicitly to `sendFollowUp` now (agent maps to UNSPECIFIED on backend — identical behavior)
- `useEffect` syncs state when prop changes externally — supports programmatic control via `SessionApp`

## Session Progress (May 17, 2026 — Session 8: CLI `--mode=plan` Flag)

### Deliverables (implemented)

1. **Go CLI `--mode` flag** — Added to `agentExecFlags` via `registerAgentExecFlags`, shared by `stigmer run`, `stigmer draft`, and all picker paths. Validates input (`"agent"`, `"plan"`, or empty). Threaded through `preparedAgentExec`, `resolvedAgentExecInput`, and `CreateAgentExecutionInput` at all 6 call sites.

2. **`buildExecutionConfig` function** — Extracted testable helper in `run_create.go`. Constructs `ExecutionConfig` proto handling `--model` and `--mode` co-existence. Returns nil when neither is set. Maps `"plan"` → `INTERACTION_MODE_PLAN`.

3. **Session header mode badge** — `sessionHeaderInfo.Mode` renders `Mode: Plan (read-only)` in the bordered header panel. Omitted for default (agent/empty).

4. **Ink subprocess passthrough** — `inkConfig.Mode` appended as `--mode <value>` to Ink CLI args in `streamAgentInk`. Mode extracted from `headerInfo.Mode`.

5. **Ink CLI entry** — `stigmer-ink.tsx` parses `--mode` / `-M` with validation. Passes through `SessionApp` → `SessionView` props.

6. **Ink `SessionView` wiring** — `sendFollowUp(message, { interactionMode: mode })` ensures all follow-ups inherit the mode. Dimmed "Plan mode" indicator shown above input when active.

7. **14 unit tests** — 6 for `validateMode` (valid/invalid values), 5 for `buildExecutionConfig` (nil/model/plan/agent/combined), 3 for `formatMetadataSection` mode row (empty/agent/plan).

### Key Design Decisions

- Mode is set on the initial execution AND propagated to Ink for follow-ups — consistent mode throughout the session
- `buildExecutionConfig` extracted as testable pure function (no gRPC dependency)
- Mode badge only shown for non-default (`"plan"`) — agent is the implicit default, no noise
- `FollowUpInput` unchanged — mode indicator placed in `SessionView` (single responsibility)
- `--mode agent` accepted but treated as no-op (UNSPECIFIED) — user can explicitly state default

## Session Progress (May 17, 2026 — Session 7: Phase 4b Build from Plan UX)

### Phase 4b Deliverables (implemented)

1. **`SessionComposerHandle`** — imperative API on `SessionComposer` via `forwardRef` + `useImperativeHandle`. Exposes `setMessage(msg)` and `focus()` for programmatic composer interaction. Exported from `@stigmer/react`.

2. **`PlanCompletionCard`** — new SDK component. Inline CTA card: "Plan complete — ready to implement?" with "Implement" button. Opt-in via `onImplement` prop (renders nothing when omitted). `role="status"`, accessible.

3. **`plan-completion` ThreadItem variant** — new `buildThreadItems` logic: emits `plan-completion` when last execution is `EXECUTION_COMPLETED` with `InteractionMode.PLAN`. Wired through `NonVirtualizedThread`, `VirtualizedThread`, and `ThreadItemRenderer`.

4. **Client app wiring** (DD-016 parity) — both web and desktop `SessionPage` wire `composerRef`, `handleBuildFromPlan` callback (switches mode to Agent, pre-fills "Implement the plan above", focuses composer), and `onBuildFromPlan` on `MessageThread`.

5. **14 unit tests** — 8 for `buildThreadItems` plan-completion logic (COMPLETED+PLAN emits, COMPLETED+AGENT/FAILED+PLAN/streaming don't), 6 for `PlanCompletionCard` (render, click, disabled, null-when-no-callback, a11y).

### Key Design Decisions

- `SessionComposerHandle` is a general-purpose capability (future: template actions, deep links, "try this example")
- Pre-fill text is hardcoded to "Implement the plan above" — configurable `suggestedMessage` deferred
- `onBuildFromPlan` is fully opt-in on `MessageThread` — backward compatible (DD-011)

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
3. ~~Consider adding CLI `--mode=plan` flag (independent, not blocking)~~ — **DONE** (Session 8)
4. ~~Consider "Build from plan" UX flow (Plan → Agent transition button)~~ — **DONE** (Session 7)
5. ~~Consider `stigmer resume --mode` flag (natural extension — currently mode only applies to `run`/`draft`)~~ — **DONE** (Session 9)
6. ~~Consider Ink `InteractionModePicker` (keyboard shortcut to toggle mode mid-session)~~ — **DONE** (Session 9)

## Context for Resume

- `--mode` flag lives in `registerAgentExecFlags` — shared by `run`, `draft`, and all picker paths
- `buildExecutionConfig(model, mode)` is the single point for `ExecutionConfig` construction in the CLI
- Mode propagates to Ink via `inkConfig.Mode` → `--mode` CLI arg → `SessionApp.mode` → `SessionView.mode` → `sendFollowUp(..., { interactionMode })`
- `validateMode` accepts `""`, `"agent"`, `"plan"` — anything else returns a user-facing error
- Go SDK proto stubs were regenerated via `make -C sdk/go codegen` — `InteractionMode` enum and `ExecutionConfig.interaction_mode` now available in `sdk/go/proto/`
- `stigmer resume --mode` now supported — auto-infers from last execution's `ExecutionConfig.InteractionMode`, explicit `--mode` overrides
- `resolveResumeMode(explicitMode, latestExec)` is the single point for resume mode resolution
- Ink `SessionView` Ctrl+T toggles mode mid-session — state initialized from `--mode` arg, each follow-up passes `{ interactionMode: activeMode }`
- `SessionComposerHandle` uses `forwardRef` + `useImperativeHandle` — the `memo` wrapper is preserved via `memo(forwardRef(...))`
- Ink SDK (CLI terminal) does NOT have a context gauge or summarization card equivalent yet

## Quick Commands

After loading context:
- "Plan Phase 5" — Admin API reconciliation
- "Add resume --mode flag" — Mode support for resumed sessions
- "Add Ink mode picker" — Terminal keyboard shortcut for mode toggle

---

*This file provides direct paths to all project resources for quick context loading.*
