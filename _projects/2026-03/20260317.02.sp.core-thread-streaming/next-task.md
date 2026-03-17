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
**Current Task**: T01 Step 2 (SDK Behavior Hook — useExecutionStream)
**Status**: Step 1 complete, Step 2 ready to start
**Last Session**: 2026-03-17 — Completed Step 1: SDK Data Hooks

## Session Progress (2026-03-17)

### Completed: Step 1 — SDK Data Hooks

- Created `useSession(id: string | null)` in `sdk/react/src/session/useSession.ts`
  - Fetches a single Session by ID via `stigmer.session.get()`
  - Returns `{ session, isLoading, error }` with full proto `Session` type
  - `null` parameter = stable no-op (consistent with other hooks)
  - Stale response suppression via `cancelled` flag pattern
- Created `useSessionExecutions(sessionId: string | null)` in `sdk/react/src/session/useSessionExecutions.ts`
  - Fetches `AgentExecution[]` for a session via `stigmer.agentExecution.listBySession()`
  - Returns `{ executions, isLoading, error, refetch }`
  - `refetch()` via `fetchKey` counter pattern (needed by SP2)
  - `pageSize: 100` — sufficient for typical sessions, full pagination deferred
  - Constructs proto request via `create(ListAgentExecutionsBySessionRequestSchema, { ... })`
- Updated barrel exports: `sdk/react/src/session/index.ts` and `sdk/react/src/index.ts`
- Verification: `npm run typecheck`, `npm run build` (sdk/react), `npm run build` (client-apps/web) all pass clean

### Key Design Decisions (Step 1)

1. **`string | null` parameter type** — Consistent null-means-skip convention across all data hooks. Matches `useExecutionStream` plan.
2. **Full proto return types** — Data hooks return `Session` and `AgentExecution` directly (not simplified wrappers). Avoids parallel type hierarchy drift.
3. **Both hooks under `session/`** — Grouped by consumption context (session view), not resource type. `useExecutionStream` will go under `execution/`.
4. **`fetchKey` counter for refetch** — Simple, testable pattern. No external state tracking.

## Next Steps

1. **Step 2**: SDK Behavior Hook — `useExecutionStream` (streaming subscription)
2. **Step 3**: SDK Styled Components — `MessageEntry`, `ToolCallGroup`, `ExecutionPhaseBadge`, `MessageThread`
3. **Step 4**: Console SessionPage — Orchestration at `/sessions/[id]`
4. **Step 5**: Barrel Exports + Dependencies (`react-markdown`, `remark-gfm`)

## Context for Resume

- Branch: `feat/session-first-web-ux`
- Step 1 files committed. Steps 2-5 pending.
- The `subscribe` method on `AgentExecutionClient` is an `AsyncGenerator<AgentExecution>` that accepts an optional `AbortSignal`. Step 2 will use this.
- `ExecutionPhase` enum values: `EXECUTION_PENDING`, `EXECUTION_IN_PROGRESS`, `EXECUTION_COMPLETED`, `EXECUTION_FAILED`, `EXECUTION_CANCELLED`, `EXECUTION_TERMINATED`, `EXECUTION_WAITING_FOR_APPROVAL`, `EXECUTION_PAUSED`. Terminal phases: COMPLETED, FAILED, CANCELLED, TERMINATED.
- `AgentExecutionStatus` has `messages: AgentMessage[]`, `toolCalls: ToolCall[]`, `phase: ExecutionPhase`, plus usage, approvals, artifacts, etc.

## Quick Commands

After loading context:
- "Continue with Step 2" - Start useExecutionStream
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
