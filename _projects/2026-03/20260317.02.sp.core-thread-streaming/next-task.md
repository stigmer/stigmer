# Next Task: 20260317.02.sp.core-thread-streaming

## RULES OF ENGAGEMENT - READ FIRST

**When this file is loaded in a new conversation, the AI MUST:**

1. **DO NOT AUTO-EXECUTE** - Never start implementing without explicit user approval
2. **GATHER CONTEXT SILENTLY** - Read all project files without outputting
3. **PRESENT STATUS SUMMARY** - Show what's done, what's pending, agreed next steps
4. **SHOW OPTIONS** - List recommended and alternative actions
5. **WAIT FOR DIRECTION** - Do NOT proceed until user explicitly confirms

### Required Status Summary Format

When resuming this sub-project, present:

- **Parent Project**: 20260317.01.session-first-web-ux
- **Overall Objective**: [1-2 sentences]
- **What's Been Completed**: [Key milestones]
- **What's Pending**: [Remaining work]
- **Agreed Focus for This Session**: [From previous session]
- **Options**: A (Recommended), B, C...

**WAIT for user to say "proceed", "go", or choose an option.**

---

## Parent Project

**Parent**: 20260317.01.session-first-web-ux
**Parent Next Task**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/next-task.md`
**Spawned From Task**: T01.6

### Inherited Knowledge (CHECK THESE FIRST)

When resuming this sub-project, also review the parent's knowledge folders
for decisions, guidelines, and lessons that apply across all sub-projects:

- Parent Design Decisions: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/design-decisions/`
- Parent Coding Guidelines: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/coding-guidelines/`
- Parent Wrong Assumptions: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/wrong-assumptions/`
- Parent Don't Dos: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/dont-dos/`

---

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this sub-project.

## Sub-Project: 20260317.02.sp.core-thread-streaming

**Description**: Build the minimum viable session view at /sessions/[id] with real-time execution streaming, message rendering (markdown), and collapsed tool call summaries. SDK hooks for data fetching and streaming, SDK styled components for messages and tool groups, Console page orchestration.
**Goal**: Users navigate to a session and see the conversation thread with user messages, markdown-rendered agent responses, collapsed tool call summaries, real-time streaming updates, auto-scroll, and terminal phase indicators.
**Tech Stack**: TypeScript/React/Next.js (frontend), Go (backend - seedpack + default agent resolution)
**Components**: client-apps/web (full UI rewrite), seedpack (new assistant agent), backend (default agent resolution in session/execution creation)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.02.sp.core-thread-streaming/checkpoints/
```

### 2. Current Task
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.02.sp.core-thread-streaming/tasks/
```

### 3. Project Documentation
- **README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.02.sp.core-thread-streaming/README.md`
- **Parent README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/README.md`

## Knowledge Folders to Check

### This Sub-Project's Knowledge
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.02.sp.core-thread-streaming/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.02.sp.core-thread-streaming/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.02.sp.core-thread-streaming/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.02.sp.core-thread-streaming/dont-dos/
```

### Parent Project's Knowledge (inherited)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.01.session-first-web-ux/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read parent's latest knowledge folders (design-decisions, coding-guidelines, wrong-assumptions, dont-dos)
2. [ ] Read this sub-project's latest checkpoint (if any) from `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.02.sp.core-thread-streaming/checkpoints/`
3. [ ] Check current task status in `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260317.02.sp.core-thread-streaming/tasks/`
4. [ ] Review this sub-project's own knowledge folders
5. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-17 18:16
**Current Task**: T01 Step 5 (Barrel Exports + Dependencies verification)
**Status**: Steps 1-4 complete, Step 5 ready to start
**Last Session**: 2026-03-17 — Completed Step 4: Console SessionPage

## Session Progress (2026-03-17, Session 4)

### Completed: Step 4 — Console SessionPage

- Rewrote `client-apps/web/src/app/sessions/[id]/SessionPage.tsx` from placeholder to full orchestration page
  - Hook orchestration: `useSession(id)`, `useSessionExecutions(id)`, `useExecutionStream(activeExecutionId)`
  - Active execution identification: walks executions from last to first, finds the first with a non-terminal phase
  - `TERMINAL_PHASES` constant for `COMPLETED`, `FAILED`, `CANCELLED`, `TERMINATED`
  - Stream-to-fetch fallback: `displayActiveExecution = stream.execution ?? fetchedActiveExecution` — prevents content flash during stream connection window (100-500ms)
  - Execution splitting: completed executions filtered from the streamed one, passed separately to `<MessageThread>`
- Four UI states:
  - **Loading**: `SessionSkeleton` — pulse-animated blocks simulating user message, AI response, tool call bar
  - **Error**: `SessionError` — centered AlertTriangle + message + "Try again" / "Go home" (matches existing `error.tsx` pattern)
  - **Empty**: `SessionStarting` — spinner + "Starting session..." for the transient window before execution is indexed
  - **Normal**: `<MessageThread>` fills page (`flex-1`), `StreamErrorBanner` at bottom if stream disconnects (WifiOff + error + "Reconnect")
- Scroll containment: `h-full flex flex-col` on SessionPage ensures `<main>` never scrolls; `MessageThread` is sole scroll container
- All sub-components (`SessionSkeleton`, `SessionError`, `SessionStarting`, `StreamErrorBanner`) are file-local — Console-specific, not exported
- Verification: `npm run typecheck`, `npm run build` (sdk/react), `npm run build` (client-apps/web) all pass clean

### Key Design Decisions (Step 4)

1. **Stream-to-fetch fallback** — When `useSessionExecutions` returns an active execution but `useExecutionStream` hasn't connected yet, the fetched snapshot fills the gap. Once the stream delivers its first snapshot, it seamlessly takes over. No content flash, no empty thread.
2. **`TERMINAL_PHASES` inlined in Console file** — Third location where this constant exists (also in `useExecutionStream` and `MessageThread`). Flagged for extraction to a shared SDK utility (`isTerminalPhase()`) as a follow-up.
3. **Console imports `ExecutionPhase` from `@stigmer/protos`** — Established pattern (org-context.tsx already does this). The Console understands domain concepts; it's the reference implementation.
4. **All sub-components are file-local** — `SessionSkeleton`, `SessionError`, `SessionStarting`, `StreamErrorBanner` are Console-specific presentation. If any prove reusable, extract to SDK later.
5. **No session header/title bar** — The thread IS the page. Session subject is a sidebar concern (recents list, not yet implemented).
6. **`window.location.reload()` for error retry** — Simplest approach for SP1. The hooks don't expose a shared retry mechanism. A more sophisticated retry can be added when needed.

## Session Progress (2026-03-17, Session 3)

### Completed: Step 3 — SDK Styled Components

- Created `ExecutionPhaseBadge` in `sdk/react/src/execution/ExecutionPhaseBadge.tsx`
  - Inline badge with icon + label for all 8 execution phases
  - Map-based config lookup (phase → icon, label, color class) — zero branching
  - Animated pulse dot for `IN_PROGRESS`, semantic colors for terminal/blocking states
  - Returns `null` for `UNSPECIFIED`
  - `role="status"` + `aria-label` for screen reader accessibility
- Created `ToolCallGroup` in `sdk/react/src/execution/ToolCallGroup.tsx`
  - Collapsed summary line for a group of tool calls from one AI turn
  - Aggregate status derivation: running > waiting > failed > completed > pending
  - Default summary: tool name for single, `"{name} ×{count}"` for homogeneous, `"{count} tool calls"` for mixed
  - Optional `formatSummary` prop for platform builders who want custom labels
  - Status-aware icons: spinner/clock/X-circle/check-circle/dot
  - `role="group"` + `aria-label` for accessibility
- Created `MessageEntry` in `sdk/react/src/execution/MessageEntry.tsx`
  - Renders messages by `MessageType`: HUMAN (plain text, muted bg), AI (markdown via react-markdown + remark-gfm), SYSTEM (muted italic), TOOL/UNSPECIFIED (nothing)
  - 15 markdown component overrides — headings, lists, code, tables, blockquotes, links — all themed via `--stgm-*` tokens
  - Streaming cursor (blinking `|`) when `isStreaming === true`
  - `role="article"` + `aria-label` per message type; `aria-busy` for streaming state
- Created `MessageThread` in `sdk/react/src/execution/MessageThread.tsx`
  - Orchestrates `MessageEntry`, `ToolCallGroup`, `ExecutionPhaseBadge` into a scrollable thread
  - Accepts `executions: AgentExecution[]` + optional `activeStreamExecution` — flattens into discriminated-union `ThreadItem[]` via `useMemo`
  - Sticky auto-scroll: tracks nearness to bottom, scrolls on new content, pauses on user scroll-up
  - `role="log"` + `aria-live="polite"` + `aria-relevant="additions"` for screen reader announcement
  - Renders nothing when no executions provided (empty state is Console concern)
- Added `react-markdown` (^10.1.0) and `remark-gfm` (^4.0.1) to `sdk/react/package.json` as regular dependencies
- Updated barrel exports: `sdk/react/src/execution/index.ts` and `sdk/react/src/index.ts`
- Verification: `npm run typecheck`, `npm run build` (sdk/react), `npm run build` (client-apps/web) all pass clean

### Key Design Decisions (Step 3)

1. **`react-markdown` as regular dependency (not peer)** — Simplest DX for styled component consumers. Tree-shaking via `sideEffects: ["*.css"]` ensures hook-only consumers pay nothing. Matches radix-ui dependency pattern.
2. **Inline SVG icons (no lucide-react)** — Zero additional SDK dependency. Consistent with ModelSelector/WorkspaceEditor pattern. ~6 small purpose-built icons total.
3. **Tool call summary: honest defaults + pluggable formatter** — Default shows tool name or count (never guesses categories). `formatSummary` prop for platform builders who know their tools.
4. **Discriminated-union `ThreadItem` type** — Keeps render loop a simple switch. Three kinds: `message`, `tool-group`, `phase-badge`. No type narrowing gymnastics.
5. **`MessageThread` accepts `AgentExecution[]` (not flattened messages)** — Preserves execution-level context for phase badges and future execution boundary rendering (SP4+).
6. **Auto-scroll via `isNearBottomRef` pattern** — Ref-based tracking avoids re-renders. Threshold of 80px. `useEffect` on `items` triggers scroll when user is near bottom.

## Session Progress (2026-03-17, Session 2)

### Completed: Step 2 — SDK Behavior Hook (`useExecutionStream`)

- Created `useExecutionStream(executionId: string | null)` in `sdk/react/src/execution/useExecutionStream.ts`
  - Subscribes to `stigmer.agentExecution.subscribe(id, signal)` (AsyncGenerator over gRPC-Web server streaming)
  - Returns `{ execution, phase, isStreaming, isConnecting, error, reconnect }`
  - Each server message replaces state atomically (full AgentExecution snapshot, no delta merge)
  - `AbortController` per subscription, stored in ref, aborted on cleanup/id-change/reconnect
  - AbortError suppression: checks `controller.signal.aborted` before setting error state
  - Terminal phase detection via `TERMINAL_PHASES` Set (COMPLETED, FAILED, CANCELLED, TERMINATED)
  - `phase` derived via `useMemo` from `execution.status?.phase` — always consistent, no stored state drift
  - `reconnect()` via `connectKey` counter pattern (consistent with `refetch()` in other hooks)
  - State clearing on `executionId` change prevents stale cross-execution data
  - Async IIFE in `useEffect` consumes generator with `for await...of` + `try/catch`
- Updated barrel exports: `sdk/react/src/execution/index.ts` and `sdk/react/src/index.ts`
- Verification: `npm run typecheck`, `npm run build` (sdk/react), `npm run build` (client-apps/web) all pass clean

### Key Design Decisions (Step 2)

1. **`phase` as derived state via `useMemo`** — Eliminates impossible state where `phase` and `execution` disagree. `EXECUTION_PHASE_UNSPECIFIED` when `execution` is `null` is semantically correct.
2. **`isStreaming` and `isConnecting` as stored state** — These track lifecycle events (loop entry/exit) not derivable from `execution` alone. `isStreaming` must become `false` when the stream ends even though `execution` still holds the last snapshot.
3. **`reconnect()` via `connectKey` counter** — Same pattern as `refetch()` in `useSessionExecutions`. Works in any lifecycle state (error, complete, mid-stream).
4. **State clearing on `executionId` change** — Unlike data hooks that keep stale data during reload, streaming hook clears `execution` to `null` when switching execution IDs. Stale data from a different execution would be actively misleading.
5. **`TERMINAL_PHASES` not exported** — Internal to the hook. Platform builders check `phase` directly. If multiple hooks/components need it, extract a shared utility then.

## Session Progress (2026-03-17, Session 1)

### Completed: Step 1 — SDK Data Hooks

- Created `useSession(id: string | null)` in `sdk/react/src/session/useSession.ts`
- Created `useSessionExecutions(sessionId: string | null)` in `sdk/react/src/session/useSessionExecutions.ts`
- Updated barrel exports: `sdk/react/src/session/index.ts` and `sdk/react/src/index.ts`
- Verification: all builds pass clean

## Next Steps

1. **Step 5**: Barrel Exports + Dependencies — Already partially done (react-markdown/remark-gfm added, barrel exports updated). Verify final export surface is clean. This is a lightweight verification step.
2. **After SP1 completion**: Update parent project `next-task.md` to mark SP1 as done and begin SP2 (Follow-up Conversation Loop).

## Context for Resume

- Branch: `feat/session-first-web-ux`
- Steps 1-4 committed. Step 5 pending (lightweight verification).
- Step 5 is primarily a check — barrel exports and dependencies were already updated during Steps 2-3. Just verify the final export surface is clean and matches the plan.
- The full data flow is now wired: `SessionPage` → `useSession` + `useSessionExecutions` + `useExecutionStream` → `<MessageThread>` → user sees conversation thread with streaming, tool call summaries, and phase badges.
- Open follow-up: extract `TERMINAL_PHASES` / `isTerminalPhase()` to a shared SDK utility (currently duplicated in 3 files).

## Quick Commands

After loading context:
- "Continue with Step 5" - Verify barrel exports and dependencies
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
