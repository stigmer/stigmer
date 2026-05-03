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
**Current Task**: T05 (Row-Level Subscriptions & Memoization — NEXT)
**Status**: T04 complete, ready for T05
**Research Report**: `_projects/2026-05/research.react-sdk-streaming-ux-quality/04.report.gpt.md`

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

1. **T05**: Row-Level Subscriptions & Memoization — `MessageThread` subscribes to `threadItemIds`, `ThreadRow` subscribes by item ID, `React.memo` on leaf components
2. **T06**: Stream Controller State Machine — rewrite `useExecutionStream` with rAF coalescing, `startTransition`, finite state machine
3. **T07**: Streaming Markdown (Streamdown) — split-path rendering for active vs completed messages

## Context for Resume

- **Store infrastructure is ready**: `ConversationStore` + `structuralShare` + React hooks exist in `sdk/react/src/internal/store/`
- **Structural sharing is live**: `useSessionConversation` applies it to `stream.execution` before passing to `MessageThread`
- **No public API changes**: All new code is internal to the SDK. `UseSessionConversationReturn`, `UseExecutionStreamReturn`, `MessageThreadProps` unchanged.
- **Store is ready for T05**: `ConversationStoreContext` and selector hooks exist for `MessageThread` rows to subscribe to in T05
- **rAF coalescing deferred**: `useExecutionStream` is untouched. T06 will rewrite it with store-backed ingestion, rAF coalescing, and `startTransition`
- Instrumentation is live: browser console shows `[stgm:perf:*]` during streaming
- Key stability warnings from `useKeyStability` should now be SILENT during normal streaming (T03 fixed the instability)
- `buildThreadItems` is now exported (for testing) — not in public API barrel

## Phase Overview (11 Phases)

| Phase | Task | Focus | Impact | Status |
|-------|------|-------|--------|--------|
| 0 | T02 | Instrument & Baseline | High | **Done** |
| 1 | T03 | Fix Keys & Pending Reconciliation | Very High | **Done** |
| 2 | T04 | Structural-Sharing Store (ConversationStore) | **Highest** | **Done** |
| 3 | T05 | Row-Level Subscriptions & Memoization | High | Pending |
| 4 | T06 | Stream Controller State Machine | High | Pending |
| 5 | T07 | Streaming Markdown (Streamdown) | High | Pending |
| 6 | T08 | Data Fetching / Cache Fix | Very High | Pending |
| 7 | T09 | Composer Isolation | High | Pending |
| 8 | T10 | Auto-Scroll State Machine | High | Pending |
| 9 | T11 | Virtualization (react-virtuoso) | High | Pending |
| 10 | T12 | Animation & Polish | Medium | Pending |

## Quick Commands

After loading context:
- "Start T05" - Begin row-level subscriptions and memoization
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
