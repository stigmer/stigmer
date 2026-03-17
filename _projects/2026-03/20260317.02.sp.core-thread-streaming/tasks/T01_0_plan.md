# Task T01: Core Thread + Streaming — Implementation Plan

**Created**: 2026-03-17 18:16
**Status**: PENDING REVIEW
**Type**: Sub-Project of 20260317.01.session-first-web-ux (T01.6 — SP1 of 5)

**This plan requires your review before execution.**

## Objective

Build the minimum viable session view at `/sessions/[id]`. Users navigate to a session and see the conversation thread with user messages, markdown-rendered agent responses, collapsed tool call summaries, real-time streaming updates, auto-scroll, and terminal phase indicators.

## What SP1 Delivers

- Conversation thread with user messages and agent responses (markdown-rendered)
- Collapsed tool call summaries ("Ran 2 commands", "Read 5 files") — not expandable
- Real-time streaming of the active execution
- Auto-scroll following new content
- Loading skeleton while data loads
- Error state if session not found or stream fails
- Terminal phase indicator at bottom of thread (Completed / Failed / etc.)

## What SP1 Does NOT Include

| Feature | Deferred To | Reason |
|---|---|---|
| Follow-up input | SP2 (20260317.03) | Separate concern — conversation loop is additive |
| Context panel content | SP3 (20260317.04) | Independent of thread rendering |
| Expandable tool groups | SP4 (20260317.05) | Collapsed summaries sufficient for MVP |
| HITL approvals | SP5 (20260317.06) | Advanced feature, not needed for basic sessions |
| Code syntax highlighting | Future | Bundle size; unstyled `<code>` is fine for now |

## Visual Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Sidebar │              Message Thread              │CtxPnl │
│         │                                          │(empty) │
│ [+New]  │  ┌─ User ────────────────────────────┐   │        │
│ ──────  │  │ Help me organize my downloads     │   │        │
│ Recents │  └────────────────────────────────────┘   │        │
│  S1 ◀── │                                          │        │
│  S2     │  Let me take a look at what's in your    │        │
│  S3     │  Downloads folder.                       │        │
│         │                                          │        │
│         │  ┌ Ran 2 commands ────────────────────┐   │        │
│         │  └────────────────────────────────────┘   │        │
│         │                                          │        │
│         │  Good, I have a clear picture now.       │        │
│         │  Let me check for actual duplicates.     │        │
│         │                                          │        │
│         │  ┌ Check MD5 checksums ───────────────┐   │        │
│         │  └────────────────────────────────────┘   │        │
│         │                                          │        │
│         │  I found the following:                  │        │
│         │  - file_a.csv is a duplicate of...       │        │
│         │  - file_b.md has different content...     │        │
│         │                                          │        │
│         │  ┌ Updated todo list, ran 5 commands ─┐   │        │
│         │  └────────────────────────────────────┘   │        │
│         │                                          │        │
│         │  Everything is organized! Here's what    │        │
│         │  was done:                               │        │
│         │  - **Usage Data/** — all 8 CSV files     │        │
│         │                                          │        │
│         │           ● Completed                    │        │
│         │                                          │        │
└─────────────────────────────────────────────────────────────┘
```

## Component Architecture

### Data Flow

```
SessionPage (Console)
  ├─ useSession(id) ──────────────► stigmer.session.get()
  ├─ useSessionExecutions(id) ───► stigmer.agentExecution.listBySession()
  ├─ useExecutionStream(activeId) ► stigmer.agentExecution.subscribe()
  └─ <MessageThread>
       ├─ <MessageEntry> (per HUMAN/AI/SYSTEM message)
       ├─ <ToolCallGroup> (per AI turn's tool_calls[])
       └─ <ExecutionPhaseBadge> (at end of thread)
```

### SDK vs Console Placement

| Component | Package | Why |
|---|---|---|
| `useSession` | `@stigmer/react` (SDK) | Platform builders need to fetch sessions |
| `useSessionExecutions` | `@stigmer/react` (SDK) | Platform builders need execution history |
| `useExecutionStream` | `@stigmer/react` (SDK) | Core streaming capability for any embed |
| `MessageThread` | `@stigmer/react` (SDK) | Drop-in conversation viewer for embeds |
| `MessageEntry` | `@stigmer/react` (SDK) | Reusable message renderer |
| `ToolCallGroup` | `@stigmer/react` (SDK) | Tool display is part of execution viewing |
| `ExecutionPhaseBadge` | `@stigmer/react` (SDK) | Phase indicator usable in any context |
| `SessionPage` | `client-apps/web` (Console) | Uses `useParams()`, org context, routing — Console-specific |

### Existing Components Reused

- `useStigmer()` — SDK client access in all hooks
- `AppShell` / `Sidebar` / `ContextPanel` — layout shell (no changes)
- shadcn primitives — `Badge`, `ScrollArea`

## Task Breakdown

### Step 1: SDK Data Hooks

**`useSession(id: string)`** in `sdk/react/src/session/useSession.ts`
- Calls `stigmer.session.get(id)` via `useStigmer()`
- Returns `{ session, isLoading, error }`
- Follows existing pattern from `useCreateSession`

**`useSessionExecutions(sessionId: string)`** in `sdk/react/src/session/useSessionExecutions.ts`
- Calls `stigmer.agentExecution.listBySession({ sessionId })`
- Returns `{ executions, isLoading, error, refetch }`
- `refetch` included now (needed by SP2) so the API is stable

### Step 2: SDK Behavior Hook — `useExecutionStream`

**`useExecutionStream(executionId: string | null)`** in `sdk/react/src/execution/useExecutionStream.ts`

The most complex piece. Subscribes to `stigmer.agentExecution.subscribe(id, signal)` (async generator over gRPC-Web server streaming).

**Returns:**
- `execution: AgentExecution | null` — latest full snapshot
- `phase: ExecutionPhase` — convenience extraction
- `isStreaming: boolean` — true while active and non-terminal
- `isConnecting: boolean` — true before first message arrives
- `error: string | null`

**Lifecycle:**
- `null` executionId → no-op (no subscription)
- Creates `AbortController` per subscription
- On `executionId` change: abort previous, start new
- On terminal phase (COMPLETED, FAILED, CANCELLED, TERMINATED): stop consuming
- On unmount: abort via cleanup
- Each update replaces state atomically (full snapshot, no delta merge)

**Error handling (SP1 scope):**
- Stream error + non-terminal phase → show error banner with "Reconnect" button
- Automatic reconnection deferred

### Step 3: SDK Styled Components

**`MessageEntry`** in `sdk/react/src/execution/MessageEntry.tsx`
- Props: `message: AgentMessage`
- HUMAN → full-width block with `bg-muted` background
- AI → markdown-rendered via `react-markdown` + `remark-gfm`. Shows streaming cursor when `is_streaming === true`
- SYSTEM → muted, small text
- TOOL → not rendered (consumed by ToolCallGroup in SP4)
- Purely presentational, no fetch, no state

**`ToolCallGroup`** in `sdk/react/src/execution/ToolCallGroup.tsx`
- Props: `toolCalls: ToolCall[]`
- Renders a single collapsed summary line per AI turn's tool calls
- Format examples: "Ran 2 commands", "Read 5 files", "Used 3 tools", or for single: "search", "bash"
- Status-aware: spinner for running, checkmark for completed, X for failed
- NOT expandable in SP1 — just the summary line

**`ExecutionPhaseBadge`** in `sdk/react/src/execution/ExecutionPhaseBadge.tsx`
- Props: `phase: ExecutionPhase`
- Inline badge: IN_PROGRESS (animated dot + "Running"), COMPLETED (check + "Completed"), FAILED (X + "Failed"), WAITING_FOR_APPROVAL (clock + "Waiting"), PAUSED (pause + "Paused")

**`MessageThread`** in `sdk/react/src/execution/MessageThread.tsx`
- Props: `executions: AgentExecution[]`, `activeStreamExecution?: AgentExecution | null`
- Flattens messages from all executions into one continuous thread
- For each AI message with `tool_calls[]`, renders `<ToolCallGroup>` after the AI text
- TOOL messages skipped (their content is for SP4 expansion)
- After last message, renders `<ExecutionPhaseBadge>` for terminal states
- **Auto-scroll (sticky scroll)**: tracks scroll position. New content auto-scrolls if user is near bottom. Manual scroll-up pauses auto-scroll. Scroll-to-bottom resumes.

### Step 4: Console SessionPage

**`SessionPage`** in `client-apps/web/src/app/sessions/[id]/SessionPage.tsx`
- Rewrite from current placeholder
- Uses `useParams()` for session ID
- Orchestrates SDK hooks:
  1. `useSession(id)` — loads session metadata
  2. `useSessionExecutions(id)` — loads execution history
  3. Identifies active execution: last execution with non-terminal phase
  4. `useExecutionStream(activeExecutionId)` — streams active execution
- Renders `<MessageThread>` with completed executions + active stream
- Loading skeleton while data loads
- Error state if session not found

### Step 5: SDK Barrel Exports + Dependencies

- Add `react-markdown` and `remark-gfm` to `sdk/react/package.json`
- Update `src/session/index.ts` — export `useSession`, `useSessionExecutions`
- Update `src/execution/index.ts` — export `useExecutionStream`, `MessageThread`, `MessageEntry`, `ToolCallGroup`, `ExecutionPhaseBadge`
- Update `src/index.ts` — re-export new symbols + types

## File Changes Summary

**SDK `@stigmer/react` — New files (7):**
- `src/session/useSession.ts`
- `src/session/useSessionExecutions.ts`
- `src/execution/useExecutionStream.ts`
- `src/execution/MessageThread.tsx`
- `src/execution/MessageEntry.tsx`
- `src/execution/ToolCallGroup.tsx`
- `src/execution/ExecutionPhaseBadge.tsx`

**SDK `@stigmer/react` — Modified files (4):**
- `src/index.ts` (new exports)
- `src/session/index.ts` (new exports)
- `src/execution/index.ts` (new exports)
- `package.json` (add `react-markdown`, `remark-gfm`)

**Console `client-apps/web` — Modified files (1):**
- `src/app/sessions/[id]/SessionPage.tsx` (rewrite from placeholder)

## Design Decisions

1. **Full-width message blocks, not chat bubbles** — Developer tool, not messaging app. Matches Claude/ChatGPT (Jakob's Law).
2. **Tool calls aggregated into collapsed summary lines** — Inspired by Claude Cowork. One line per AI turn's tool calls. Progressive disclosure (Hick's Law).
3. **`useExecutionStream` stores full snapshots** — Subscribe RPC sends complete AgentExecution each time. Hook replaces state atomically. No delta merge.
4. **Continuous thread across executions** — No visual separators between execution boundaries. One conversation, not separate runs.
5. **Auto-scroll with user override** — Standard sticky scroll pattern from VS Code terminal, Cursor chat.
6. **`MessageThread` accepts `AgentExecution[]`** — Not raw `AgentMessage[]`. Preserves execution-level context for grouping and phase display.
7. **TOOL messages skipped in rendering** — Tool results will be consumed by ToolCallGroup expansion in SP4.
8. **No context panel changes** — Panel shell exists, content deferred to SP3.

## Risks

- **`react-markdown` bundle size**: ~40KB gzipped. Acceptable. Tree-shaking ensures hook-only consumers don't pay.
- **Streaming disconnection**: gRPC-Web over WebSocket can drop. SP1 shows error banner with manual reconnect. Auto-reconnect deferred.
- **Large execution payloads**: Full AgentExecution per update. React state replacement is cheap; rendering is the bottleneck. Virtualized lists deferred.

## Implementation Order

```
Step 1: Data hooks (useSession, useSessionExecutions)
  ↓
Step 2: Streaming hook (useExecutionStream)
  ↓
Step 3: Styled components (MessageEntry, ToolCallGroup, ExecutionPhaseBadge, MessageThread)
  ↓
Step 4: Console SessionPage (orchestration)
  ↓
Step 5: Barrel exports + dependencies
```

## Success Criteria

- [ ] User creates session from launcher, navigates to `/sessions/[id]`, sees conversation thread
- [ ] Agent messages render with markdown (bold, lists, code blocks, links)
- [ ] Tool calls appear as collapsed summary lines ("Ran 2 commands")
- [ ] Active execution streams in real-time — messages appear as they arrive
- [ ] Thread auto-scrolls during streaming, pauses when user scrolls up
- [ ] Terminal phase shows at bottom (Completed / Failed)
- [ ] Loading skeleton shows while data fetches
- [ ] Error state shows if session not found
- [ ] SDK hooks and components export cleanly from `@stigmer/react`
- [ ] `npm run build` passes for both `sdk/react` and `client-apps/web`
