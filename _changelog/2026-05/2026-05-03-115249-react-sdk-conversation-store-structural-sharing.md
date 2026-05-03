# React SDK: ConversationStore with Structural Sharing

**Date**: May 3, 2026

## Summary

Added a structural-sharing ingestion layer to the `@stigmer/react` SDK that sits between gRPC execution snapshots and React rendering. When a new `AgentExecution` snapshot arrives, the `structuralShare` function compares it against the previous snapshot and preserves object references for unchanged messages, tool calls, sub-agents, and approvals. This is the architectural foundation that enables downstream `React.memo` boundaries (T05) to prevent unnecessary re-renders during streaming.

## Problem Statement

The `@stigmer/react` SDK's streaming pipeline receives full `AgentExecution` snapshots from the server roughly every 500ms. Each snapshot is a fresh protobuf object graph — even if only the last message's content grew by a few tokens, every nested object has a new reference. This defeats React's memoization: `React.memo` comparisons fail, `useMemo` dependencies invalidate, and the entire message thread re-renders on every tick.

### Pain Points

- Every `AgentExecution` snapshot from the gRPC stream is a completely new object graph — no reference reuse
- Completed messages that haven't changed still get new references, causing unnecessary re-renders when `React.memo` is applied
- The `MessageThread` component rebuilds its entire `items` array on every snapshot because `activeStreamExecution` is always a new reference
- No infrastructure exists for row-level subscriptions — every component re-renders top-down

## Solution

A three-layer internal store architecture that preserves object identity for unchanged entities:

1. **`structuralShare(prev, next)`** — Pure comparison function that walks the `AgentExecution` tree and produces a hybrid object reusing old references for unchanged subtrees
2. **`ConversationStore`** — Framework-agnostic class implementing the `useSyncExternalStore` contract with structural sharing on ingestion
3. **React integration hooks** — Internal context, provider, and selector hooks for `useSyncExternalStore` subscriptions

## Implementation Details

### Structural Sharing Strategy

The strategy was designed after analyzing the actual message production pipeline in the Python Graphton runner, Java/Go backend persistence, and Redis streaming infrastructure:

- **Messages**: Compared by array index (runner only appends, never reorders). Field-level comparison: `content`, `type`, `isStreaming`, `timestamp`, `toolCalls.length`. If all match, the previous `AgentMessage` reference is reused.
- **Tool calls**: Compared by `id` field within each message. Field-level comparison: `status`, `result`, `isStreaming`, `completedAt`, `error`, `name`.
- **Sub-agent executions**: Compared by `id` field. Recursive structural sharing on inner messages.
- **Pending approvals**: Compared by `toolCallId`. Full array reuse when all entries match.
- **Todos**: Compared by map key with reference equality on values.
- **Status-level**: If all collections and scalar fields (`phase`, `error`, `startedAt`, `completedAt`, `runnerId`) match, the entire `status` reference is reused. If the entire execution is unchanged, the `prev` reference is returned (no notification to listeners).

### Design Decision: Execution-Level Sharing over Entity Maps

The original T04 plan proposed normalizing into flat entity maps (`Map<string, AgentMessage>`, etc.). This was rejected because:

1. `AgentMessage` has no stable `id` field — synthetic keys add abstraction without semantic gain
2. Tool calls are owned by their parent message — denormalization breaks the natural containment hierarchy
3. The protobuf structure IS the domain model — a flat entity map is a Redux/Normalizr pattern that fights the proto structure
4. Execution-level structural sharing achieves the same render optimization when paired with `React.memo` in T05

### ConversationStore

A vanilla TypeScript class (no React dependency) that:

- Holds `AgentExecution | null` and `StreamState` (discriminated union: idle/connecting/streaming/complete/error)
- Applies `structuralShare` on every `ingestSnapshot()` call
- Only notifies listeners when references actually change
- Implements the `subscribe` / `getSnapshot` contract required by React's `useSyncExternalStore`
- Methods are bound (safe to destructure for `useSyncExternalStore`)

### Wiring into useSessionConversation

`useSessionConversation` now applies structural sharing to `stream.execution` before assembling `activeStreamExecution`. Completed messages within the execution keep their previous references, so when T05 adds `React.memo` on `MessageEntry`, those rows will not re-render.

`useExecutionStream` was intentionally left unchanged — existing tests assert strict reference equality (`toBe`) on pushed snapshots, and modifying the hook would break them. The rAF coalescing and stream controller rewrite are naturally T06's scope.

### New Files

| File | Purpose |
|------|---------|
| `sdk/react/src/internal/store/structural-share.ts` | Pure `structuralShare(prev, next)` function |
| `sdk/react/src/internal/store/conversation-store.ts` | `ConversationStore` class with `useSyncExternalStore` contract |
| `sdk/react/src/internal/store/index.ts` | React context, provider, and selector hooks |
| `sdk/react/src/internal/store/__tests__/structural-share.test.ts` | 19 unit tests |
| `sdk/react/src/internal/store/__tests__/conversation-store.test.ts` | 15 unit tests |

### Modified Files

| File | Change |
|------|--------|
| `sdk/react/src/session/useSessionConversation.ts` | Added `structuralShare` import and application to `stream.execution` |

## Benefits

- **Foundation for T05 memoization**: When `React.memo` is added to `MessageEntry`, `ToolCallGroup`, and `SubAgentSection`, stable references from structural sharing will prevent completed rows from re-rendering during streaming
- **Reduced GC pressure**: Fewer new objects created per snapshot — finalized messages reuse previous references
- **Store infrastructure for T05/T06**: `ConversationStore` and React hooks are ready for row-level subscriptions (T05) and stream controller rewrite (T06)
- **Zero public API changes**: All new code is internal to `@stigmer/react`. `UseSessionConversationReturn`, `UseExecutionStreamReturn`, and `MessageThreadProps` are unchanged.

## Impact

- **SDK consumers**: Zero impact — no API changes, no new dependencies, no behavioral changes
- **Test suite**: 300/300 pass (34 new + 266 existing unchanged)
- **Bundle size**: New code is ~3KB uncompressed (structural share function + store class + context). Tree-shakeable if unused.
- **Backward compatibility**: Complete — all existing hooks, components, and test contracts preserved

## Related Work

- Preceded by: [React SDK Stable Thread Keys](2026-05-03-104710-react-sdk-stable-thread-keys.md) (T03) — stable keys that this store's structural sharing relies on
- Preceded by: [React SDK Streaming Render Instrumentation](2026-05-03-102015-react-sdk-streaming-render-instrumentation.md) (T02) — dev instrumentation that measures the effect of structural sharing
- Next phase: T05 (Row-Level Subscriptions & Memoization) will use the store hooks so `MessageThread` rows subscribe by item ID and `React.memo` can leverage stable references
- Future: T06 (Stream Controller State Machine) will rewrite `useExecutionStream` to ingest directly into the store with rAF coalescing

---

**Status**: Production Ready
**Timeline**: T04 of the React SDK Streaming UX project (Phase 2: Structural-Sharing Store)
