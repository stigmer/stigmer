# Next Task: 20260503.01.react-sdk-streaming-ux

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260503.01.react-sdk-streaming-ux

**Description**: Eliminate flickering, jank, and navigation flash in the @stigmer/react SDK's message thread and session composer by re-architecting the data flow from gRPC stream to React rendering. Implements structural-sharing snapshot ingestion, row-level subscriptions, streaming-aware markdown, key-based session caching, virtualization, and composer isolation.
**Goal**: Deliver a state-of-the-art, flicker-free, production-quality streaming conversation experience in @stigmer/react that is comparable to ChatGPT/Claude/Cursor — customers can confidently embed it as a plug-and-play component in their products.
**Tech Stack**: TypeScript, React 19, @stigmer/react SDK, @stigmer/sdk, @connectrpc/connect (gRPC), @bufbuild/protobuf, react-markdown, Streamdown, react-virtuoso, Tailwind CSS v4, @stigmer/theme
**Components**: sdk/react (MessageThread, MessageEntry, useExecutionStream, useSessionConversation, SessionComposer, useFetch), sdk/typescript (AgentExecutionClient.subscribe), client-apps/web (SessionPage, Sidebar)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.01.react-sdk-streaming-ux/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.01.react-sdk-streaming-ux/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.01.react-sdk-streaming-ux/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.01.react-sdk-streaming-ux/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.01.react-sdk-streaming-ux/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.01.react-sdk-streaming-ux/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.01.react-sdk-streaming-ux/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.01.react-sdk-streaming-ux/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.01.react-sdk-streaming-ux/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.01.react-sdk-streaming-ux/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.01.react-sdk-streaming-ux/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.01.react-sdk-streaming-ux/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260503.01.react-sdk-streaming-ux/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-05-03
**Current Task**: T10 (Auto-Scroll State Machine — NEXT)
**Status**: T09 complete, ready for T10
**Research Report**: `_projects/2026-05/research.react-sdk-streaming-ux-quality/04.report.gpt.md`

## Session Progress (2026-05-03, Session 8)

- Implemented T09: Composer Isolation
- Challenged original T09 plan — "stabilize all callback props with useCallback" was necessary but NOT sufficient. Discovered three object-typed props (`workspace`, `gitHubConnection`, `sessionVariables`) were new references every render despite unchanged internal values. These hooks returned plain object literals without memoization.
- Narrowed `handleSubmit` deps from `conv` (entire conversation object, new every frame) to `conv.sendFollowUp` (stable `useCallback` reference) + `sessionVariables.clear`
- Stabilized `useWorkspaceEntries` return — wrapped in `useMemo`, all callbacks already `useCallback`'d
- Stabilized `useSessionVariables` return — same pattern, hoisted inline `isEmpty` to local for memo deps
- Stabilized `useGitHubConnection` return — same pattern, hoisted inline `isConnected` to local
- Wrapped `SessionComposer` in `React.memo` — no custom comparator needed once all props stable
- `useRenderTracer` was already present from T02 — provides dev-time verification
- 13 new tests (5 workspace stability, 6 session variables stability, 2 composer memo structure)
- Full suite 408/408 pass, typecheck clean, lint clean

### Key Design Decision: Fix at the Source vs. Custom areEqual
- Could have written a custom `areEqual` comparator for React.memo that deep-compares workspace/sessionVariables/gitHubConnection
- Rejected: couples the comparator to internal structure of those types, fragile, benefits only this one consumer
- Chose: stabilize each hook's return value with `useMemo` — principled, benefits ALL consumers, standard React performance practice

### Surprise: handleSubmit Depends on Full `conv` Object
- `handleSubmit` in `useSessionPageFlow` had `conv` in its `useCallback` dep array
- `conv` is the return of `useSessionConversation` — a plain object literal, new reference every render
- The function body only calls `conv.sendFollowUp(...)` — narrowed dep to `conv.sendFollowUp` (which is a stable `useCallback`)
- Same for `sessionVariables` → `sessionVariables.clear`

## Session Progress (2026-05-03, Session 7)

- Implemented T08: Data Fetching / Cache Fix
- Challenged original T08 plan — rejected TanStack Query in Console (deep SDK composition makes it impractical), rejected cache in ConversationStore (wrong responsibility), rejected TanStack Query adapter export (premature)
- Built `FetchCache` class — lightweight keyed in-memory cache with TTL (5 min default), LRU eviction (100 entries default), `prefetch`, `invalidatePrefix`
- Built `FetchCacheProvider` + `useFetchCache` — React context provider, graceful null fallback when no provider mounted
- Integrated cache into `useFetch` — reads on mount (skip skeleton), reads on dep change, writes on success; new optional `cacheKey` in `UseFetchOptions`
- Added `cacheKey` to `useSession` (`session:${id}`) and `useSessionExecutions` (`session-executions:${sessionId}`)
- Wired `FetchCacheProvider` in `AppShell` above `key={activeSessionId}` remount boundary
- Exported `FetchCacheProvider` and `FetchCacheOptions` from SDK barrel (`index.ts`)
- 31 new tests (18 FetchCache unit, 8 useFetch cache integration, 5 useSession cache behavior)
- Full suite 395/395 pass, typecheck clean, lint clean

### Key Design Decision: SDK-level FetchCache vs TanStack Query
- Data fetching is deeply composed inside SDK hooks: `SessionPageInner → useSessionPageFlow → useSessionConversation → useSession → useFetch`
- Replacing useFetch with TanStack Query at the Console level would require duplicating SDK composition, threading TanStack Query through SDK hooks, or doubling the API surface — none proportional to the problem
- FetchCache is ~120 lines, no new dependencies, benefits all 27+ useFetch consumers, clean upgrade path to TanStack Query keys

### Key Design Decision: Keep `key={activeSessionId}` Pattern
- The `key` prop is the correct React pattern for cleanly resetting all hook state (stream controller, pending execution, approval state)
- The problem was not `key` — it was `useFetch` having no memory across mounts
- FetchCache gives useFetch memory; `key` continues to provide clean state resets

### Surprise: renderHook Creates Independent React Trees
- Each `renderHook` call creates an independent React tree — `useRef`-based providers don't share state across trees
- Tests needed direct `FetchCacheContext.Provider` injection with a shared `FetchCache` instance to simulate cross-mount behavior
- Exported `FetchCacheContext` for test-level injection (not public API, internal)

## Session Progress (2026-05-03, Session 6)

- Implemented T07: Streaming Markdown (Streamdown)
- Replaced `react-markdown` with Vercel's `Streamdown` in `AiMessage` — block-level memoization, incomplete-syntax healing via `remend`, built-in caret
- Added `streamdown ^2.5.0` dependency, Tailwind `@source` directive
- `MARKDOWN_COMPONENTS` (typed as `Components` from `react-markdown`) accepted by Streamdown without type errors
- Removed manual pulsing caret — Streamdown renders `▋` via CSS `::after` when `isAnimating` is true
- Kept `react-markdown` + `remark-gfm` for static consumers (`SkillDetailView`, `ArtifactContentRenderer`)
- 17 new MessageEntry tests, full suite 364/364 pass, typecheck clean, lint clean

### Key Design Decision: Streamdown for AiMessage Only
- `SkillDetailView` and `ArtifactContentRenderer` render static, complete markdown — `react-markdown` is the right tool
- Streamdown is only needed where content streams incrementally (the `AiMessage` path)
- Keeps blast radius minimal; future migration to Streamdown `mode="static"` possible but not T07 scope

### Key Design Decision: Built-in Block Caret
- Old caret: 2px `<span>` with `animate-pulse` appended after `<Markdown>` output
- New caret: Streamdown `caret="block"` renders `▋` (U+258B) as CSS `::after` on the last block
- Standard AI chat pattern (ChatGPT, Claude) — no extra DOM element, no animation spans
- Appears only when `isAnimating={true}`, removed entirely when streaming ends

## Session Progress (2026-05-03, Session 5)

- Implemented T06: Stream Controller State Machine
- Created `StreamController` class — framework-agnostic FSM with rAF coalescing (idle → connecting → streaming → complete → error)
- Rewrote `useExecutionStream` to feed `ConversationStore` directly via the controller, wrapped in `startTransition`
- Removed duplicate structural sharing from `useSessionConversation` (13 lines deleted)
- Hook now accepts optional `ConversationStore` param — backward compatible standalone usage preserved
- Discovered `useStreamRate` referential instability causing infinite render loops — fixed with ref indirection
- 31 new StreamController tests, 12 rewritten hook tests, full suite 347/347 pass, typecheck clean, lint clean

### Key Design Decision: startTransition Wrapping Store Mutations
- The rAF callback calls `startTransition(() => store.ingestSnapshot(buffered))` 
- This marks the resulting `useSyncExternalStore` re-render as non-urgent
- React can interrupt thread renders if the user types in the composer
- Safe because the store holds the truth — next frame's flush delivers latest data regardless

### Key Design Decision: Optional Store Parameter
- `useExecutionStream(id, { store })` accepts an external store for shared usage
- When omitted, creates an internal fallback store automatically
- This preserves backward compatibility while enabling `useSessionConversation` to share its store
- Same pattern as dependency injection — keeps the hook testable without React context

### Surprise: useStreamRate Creates New Object Per Render
- `useStreamRate()` returns a new tracker object every render (ref-backed state but referentially unstable container)
- Including it in effect deps caused an infinite loop: re-render → new ref → effect re-runs → store mutation → re-render → ∞
- Fixed by storing tracker in a stable `useRef` and reading `streamRateRef.current` inside the effect

## Session Progress (2026-05-03, Session 4)

- Implemented T05: Row-Level Memoization via React.memo + Structural Sharing
- Architecture decision: chose `React.memo` on leaf components over store-backed `ThreadRow` subscriptions (deferred to T11 for virtualization)
- Wrapped 6 components in `React.memo`: `MessageEntry`, `ToolCallGroup` (custom `areEqual`), `SubAgentSection`, `ApprovalCard`, `SetupProgress`, `ExecutionPhaseBadge`
- Extracted `ApprovalCardRow` wrapper in `MessageThread` to stabilize the `onSubmit` callback (inline closure was defeating memo on every render)
- Optimized `buildThreadItems` to reuse `msg.toolCalls` array directly when no `task` tool calls are present (common case), preserving the structurally shared reference
- Exported `toolCallGroupPropsEqual` from `ToolCallGroup` for direct testing
- 13 new tests in `thread-memoization.test.ts` (areEqual unit tests + structural sharing integration)
- Full suite 313/313 pass, typecheck clean, lint clean

### Key Design Decision: React.memo vs Store-Backed Subscriptions
- Original T05 plan proposed `ThreadRow` subscribing to `ConversationStore` independently (selector pattern)
- Rejected because: (1) `ConversationStore` holds domain state (`AgentExecution`), thread items are presentation — conflates layers, (2) adding a `ThreadItemStore` is significant complexity without proportional benefit at this stage
- Chose `React.memo` on leaf components relying on T04's structural sharing for reference stability
- Same optimization outcome: during streaming, only the actively changing row re-renders
- Store-backed subscriptions deferred to T11 where virtualization demands independent data access per row

### Key Design Decision: Custom areEqual for ToolCallGroup
- `buildThreadItems` creates a new `regularTools` subset array (filtering out `task` calls)
- Even with structural sharing, the array container is new — default `React.memo` comparison fails
- Custom `toolCallGroupPropsEqual` compares array elements by reference (O(k), k typically 1-5)
- Optimization: when no `task` tools exist (common case), `msg.toolCalls` is passed directly, making even the custom comparison unnecessary

## Session Progress (2026-05-03, Session 3)

- Implemented T04: ConversationStore with Structural Sharing
- Deep-dived the agent runner (Python Graphton) and backend (Java/Go) to understand message mutation semantics:
  - Messages are append-only slots (never reordered/removed), but content at each slot mutates during streaming
  - Summarization only touches `context_info`, not `status.messages`
  - Each `updateStatus` RPC sends full status; backend does full array replacement
- Challenged the original plan's entity-map approach (`Map<string, AgentMessage>`) — recommended execution-level structural sharing instead, because `AgentMessage` has no stable ID and denormalizing tool calls out of their parent message breaks the domain model
- Built `structuralShare(prev, next)` — pure function that walks the `AgentExecution` tree, compares by natural keys (index for messages, `id` for tool calls/sub-agents, `toolCallId` for approvals), preserves unchanged references
- Built `ConversationStore` — vanilla JS class implementing `useSyncExternalStore` contract with structural sharing on ingestion
- Built React integration hooks: `ConversationStoreContext`, `useConversationStore`, `useConversationStoreRef`, `useStoreExecution`, `useStoreStreamState` (all internal, not exported)
- Wired structural sharing into `useSessionConversation` — `activeStreamExecution` now has stable inner references for unchanged messages, tool calls, and sub-agents
- `useExecutionStream` left unchanged — modifying it would break existing tests that assert strict reference equality (`toBe`). rAF coalescing deferred to T06 (stream controller rewrite)
- 34 new tests (19 structural-share + 15 conversation-store), full suite 300/300 pass, typecheck clean

### Key Design Decision: Execution-Level Sharing vs Entity Maps
- Original plan proposed `Map<string, AgentMessage>` normalization
- Rejected because: (1) `AgentMessage` has no stable ID, (2) tool calls are owned by parent messages — denormalization breaks containment, (3) proto structure IS the domain model per Architect role
- Chose execution-level structural sharing: walks the tree, preserves old references for unchanged subtrees
- Same render optimization when paired with T05 `React.memo` — simpler, more maintainable

### Key Design Decision: useExecutionStream Not Modified
- Existing tests use `toBe(snapshot)` to verify exact reference identity
- Structural sharing produces hybrid objects, breaking these assertions
- The rAF coalescing is naturally T06's domain (stream controller state machine)
- Structural sharing is applied in `useSessionConversation` instead, which is the path to `MessageThread`

## Session Progress (2026-05-03, Session 2)

- Implemented T03: Fix Keys & Pending Reconciliation
- Replaced all index-based keys (`e${ei}-m${mi}`) with execution-ID keys (`${execId}-m${mi}`)
- Bridged pending → confirmed user message with shared `pending-user-turn` key
- Pending messages now render through `MessageEntry` (same component type) for seamless React reconciliation
- Used `SubAgentExecution.id` directly for sub-agent keys; scoped sub-agent inner items by `subAgentId`
- Added duplicate key detection to `useKeyStability` dev hook
- Added 14 new tests in `thread-keys.test.ts`
- Full suite 266/266 pass, lint + typecheck clean
- Committed as `7dd39aafe`

### Key Finding: AgentMessage has no `id` field
- Discovered during T03 that `AgentMessage` proto has no stable ID
- Used `executionId + messageArrayIndex` as the key (messages are append-only, so index is stable within an execution)
- T04 confirmed this via runner code analysis: messages are append-only slots, mutated in place during streaming

## Session Progress (2026-05-03, Session 1)

- Reviewed and approved T01 Master Plan
- Implemented T02: dev-only streaming render instrumentation
- Created 6 new utilities in `sdk/react/src/internal/dev/`
- Integrated into 6 existing files (30 lines total, all dev-gated)
- 9 unit tests, full suite 252/252 pass, lint + typecheck clean
- Committed as `39c8e2ee3`

## Next Steps

1. **T10**: Auto-Scroll State Machine — IntersectionObserver + follow mode
2. **T11**: Virtualization (react-virtuoso)
3. **T12**: Animation & Polish

## Context for Resume

- **Composer is isolated**: `SessionComposer` wrapped in `React.memo`. Does NOT re-render during streaming. `useRenderTracer` from T02 provides dev-time verification.
- **Hook returns are stable**: `useWorkspaceEntries`, `useSessionVariables`, `useGitHubConnection` all return memoized objects. Safe as deps in `useEffect`/`useMemo`/`useCallback`.
- **`handleSubmit` is stable during streaming**: Depends on `conv.sendFollowUp` (stable `useCallback`) not `conv` (new object every frame).
- **FetchCache is live**: `FetchCacheProvider` wraps `AppShell`; `useSession` and `useSessionExecutions` use `cacheKey` for cross-mount caching. Previously visited sessions render instantly, background refetch for freshness.
- **Streamdown is live**: `AiMessage` renders via `Streamdown` with `isAnimating={isStreaming}` and `caret="block"`. Block-level memoization and `remend` incomplete-syntax healing are active during streaming.
- **`react-markdown` still used for static consumers**: `SkillDetailView`, `ArtifactContentRenderer` use `react-markdown` + `REMARK_PLUGINS`. Both dependencies remain in `package.json`.
- **Stream controller is live**: `useExecutionStream` uses `StreamController` (FSM) + rAF coalescing + `startTransition`. React commits at most once per display frame during streaming.
- **ConversationStore is the source of truth**: `useExecutionStream` feeds the store directly. `useSessionConversation` shares its store via the `store` option.
- **Memoization is live**: All leaf thread components wrapped in `React.memo` (T05). Combined with rAF coalescing and Streamdown's block-level memoization, completed rows skip re-render entirely during streaming.
- **No public API changes**: `UseExecutionStreamReturn` shape is unchanged. `MessageEntry` props unchanged. `FetchCacheProvider` is the only new public export.
- **startTransition in place**: Thread renders are non-urgent.
- **Instrumentation is live**: `[stgm:perf:stream]` console logs still fire during streaming.

## Phase Overview (11 Phases)

| Phase | Task | Focus | Impact | Status |
|-------|------|-------|--------|--------|
| 0 | T02 | Instrument & Baseline | High | **Done** |
| 1 | T03 | Fix Keys & Pending Reconciliation | Very High | **Done** |
| 2 | T04 | Structural-Sharing Store (ConversationStore) | **Highest** | **Done** |
| 3 | T05 | Row-Level Memoization (React.memo) | High | **Done** |
| 4 | T06 | Stream Controller State Machine | High | **Done** |
| 5 | T07 | Streaming Markdown (Streamdown) | High | **Done** |
| 6 | T08 | Data Fetching / Cache Fix | Very High | **Done** |
| 7 | T09 | Composer Isolation | High | **Done** |
| 8 | T10 | Auto-Scroll State Machine | High | Pending |
| 9 | T11 | Virtualization (react-virtuoso) | High | Pending |
| 10 | T12 | Animation & Polish | Medium | Pending |

## Quick Commands

After loading context:
- "Start T10" - Begin auto-scroll state machine
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
