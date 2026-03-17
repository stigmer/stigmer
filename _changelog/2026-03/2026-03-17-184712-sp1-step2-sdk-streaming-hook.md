# SP1 Step 2: SDK Execution Streaming Hook (`useExecutionStream`)

**Date**: March 17, 2026

## Summary

Added `useExecutionStream` — a behavior hook in `@stigmer/react` that subscribes to real-time `AgentExecution` updates via gRPC-Web server streaming. This is the most complex hook in the SDK, managing an async generator lifecycle, AbortController cancellation, and multiple state transitions within a React-idiomatic API.

## Problem Statement

Platform builders embedding Stigmer need to stream live execution updates into their React applications. The underlying `agentExecution.subscribe()` API exposes an `AsyncGenerator<AgentExecution>` — a powerful primitive, but one that requires careful lifecycle management in React: handling effect cleanup, AbortController wiring, abort error suppression, terminal phase detection, reconnection, and state consistency across re-renders.

### Pain Points

- Raw async generator consumption in React effects is error-prone (missing cleanup, stale state, abort errors surfaced as real errors)
- Platform builders should not need to understand gRPC-Web streaming internals or Connect-RPC cancellation semantics
- Multiple boolean states (`isConnecting`, `isStreaming`) and their transitions are easy to get wrong without a well-tested hook

## Solution

A single behavior hook — `useExecutionStream(executionId: string | null)` — that encapsulates the entire streaming subscription lifecycle and exposes a clean, destructurable return type matching established SDK patterns.

## Implementation Details

**New file**: `sdk/react/src/execution/useExecutionStream.ts`

**API surface**:

```typescript
interface UseExecutionStreamReturn {
  readonly execution: AgentExecution | null;
  readonly phase: ExecutionPhase;          // derived via useMemo
  readonly isStreaming: boolean;
  readonly isConnecting: boolean;
  readonly error: string | null;
  readonly reconnect: () => void;
}
```

**Key design decisions**:

1. **`phase` derived via `useMemo`** from `execution.status?.phase` — eliminates impossible state where `phase` and `execution` disagree. No stored state drift.
2. **`isStreaming` / `isConnecting` as stored state** — lifecycle events (stream entry/exit) are not derivable from `execution` alone; event-driven transitions require explicit state.
3. **`reconnect()` via `connectKey` counter** — consistent with `refetch()` in `useSessionExecutions`. Works in any lifecycle state.
4. **AbortError suppression** — `controller.signal.aborted` is checked before setting error state, distinguishing intentional cancellation from real failures.
5. **State clearing on `executionId` change** — clears `execution` to `null` when switching IDs, preventing stale cross-execution data (unlike data hooks which keep stale data during reload).
6. **Terminal phases** (`COMPLETED`, `FAILED`, `CANCELLED`, `TERMINATED`) detected via module-level `Set` to break the generator loop.

**Barrel exports updated** in `execution/index.ts` and root `index.ts`.

## Benefits

- Platform builders get a React-native streaming API with 1 import and 1 hook call
- 5-minute integration: destructure `{ execution, isStreaming, error, reconnect }` and render
- Correct-by-construction lifecycle: no leaked subscriptions, no stale state, no abort errors surfaced to users
- Consistent with existing SDK hook patterns (`useSession`, `useSessionExecutions`, `useCreateAgentExecution`)

## Impact

- **SDK (`@stigmer/react`)**: New public export — `useExecutionStream` + `UseExecutionStreamReturn`
- **Console (`client-apps/web`)**: No changes yet; will be consumed by `SessionPage` in Step 4
- **Platform builders**: Can now build custom real-time execution viewers on top of this hook

## Related Work

- Depends on: SP1 Step 1 (SDK Data Hooks — `useSession`, `useSessionExecutions`)
- Consumed by: SP1 Step 3 (SDK Styled Components — `MessageThread`, `MessageEntry`)
- Part of: Sub-project 20260317.02.sp.core-thread-streaming (SP1 of session-first-web-ux)
- Previous changelog: `2026-03-17-182939-sp1-step1-sdk-data-hooks.md`

---

**Status**: Production Ready
**Timeline**: Single session (~1 hour including planning and review)
