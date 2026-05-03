# React SDK: Row-Level Memoization for Streaming Conversations

**Date**: May 3, 2026

## Summary

Wrapped all leaf thread components (`MessageEntry`, `ToolCallGroup`, `SubAgentSection`, `ApprovalCard`, `SetupProgress`, `ExecutionPhaseBadge`) in `React.memo`, completing the render optimization layer that makes T04's structural sharing visible to the React reconciler. During token streaming, only the actively changing row re-renders — completed messages, tool groups, and sub-agent sections skip re-rendering entirely, eliminating react-markdown re-parsing and unnecessary DOM mutations.

## Problem Statement

After T04 introduced structural sharing, unchanged messages kept their previous object reference across stream ticks. However, React had no way to exploit this stability — every stream tick caused `MessageThread` to re-render, which re-rendered all children including completed messages. Each completed AI message re-ran react-markdown (full markdown parse + VDOM creation), the most expensive single operation in the thread render path.

### Pain Points

- react-markdown re-parsing a 500-word completed AI response on every stream tick (~10-15 ticks/second)
- ToolCallGroup re-deriving aggregate status and rebuilding its sub-agent map on every tick
- SubAgentSection re-building its internal thread items on every tick
- All DOM mutations flowing through even when the rendered output would be identical

## Solution

Wrap leaf thread components in `React.memo` so they skip re-rendering when their props haven't changed. T04's structural sharing guarantees that unchanged domain objects (messages, tool calls, sub-agents) keep their previous reference, making `React.memo`'s default shallow comparison effective.

For `ToolCallGroup`, a custom `areEqual` function compares the `toolCalls` array elements by reference rather than the array itself, because `buildThreadItems` creates a new filtered subset on each call. An optimization in `buildThreadItems` also avoids creating this subset in the common case (no `task` tool calls), passing `msg.toolCalls` directly.

For `ApprovalCard`, an internal `ApprovalCardRow` wrapper component stabilizes the `onSubmit` callback that was previously an inline closure in `MessageThread`'s render loop.

## Implementation Details

### Components Memoized

| Component | Comparison | Rationale |
|-----------|-----------|-----------|
| `MessageEntry` | Default | `message` ref is stable via structural sharing |
| `ToolCallGroup` | Custom `toolCallGroupPropsEqual` | `toolCalls` array is rebuilt; elements are stable |
| `SubAgentSection` | Default | `subAgentExecution` ref is stable via structural sharing |
| `ApprovalCard` | Default | `pendingApproval` ref is stable via structural sharing |
| `SetupProgress` | Default | Props are primitives or stable arrays |
| `ExecutionPhaseBadge` | Default | Props are primitives |

### Callback Stabilization

- Extracted `ApprovalCardRow` in `MessageThread` — receives stable `onApprovalSubmit` + `toolCallId`, composes the callback via `useCallback`, passes to memoized `ApprovalCard`

### buildThreadItems Optimization

- When no `task` tool calls exist (common case), `msg.toolCalls` is passed directly instead of creating a new `regularTools` array
- Preserves the structurally shared array reference through to `ToolCallGroup`

### Tests

- 13 new tests in `thread-memoization.test.ts`
- `toolCallGroupPropsEqual`: 8 unit tests covering same refs, different refs, length mismatch, className change, subAgentExecutions change, formatSummary change, empty arrays
- `buildThreadItems` array reuse: 2 tests verifying reference stability with and without task tools
- Structural sharing integration: 3 tests verifying the end-to-end chain from `structuralShare` through `buildThreadItems`

## Benefits

- **Completed messages**: Zero re-renders during streaming (react-markdown parse eliminated)
- **Completed tool groups**: Zero re-renders (status derivation, sub-agent map skipped)
- **Completed sub-agents**: Zero re-renders (internal thread item building skipped)
- **Only the streaming row re-renders**: The active AI message with changing `content` and `isStreaming=true`
- **No public API changes**: All changes are internal to the SDK

## Impact

- **SDK consumers**: Automatic performance improvement with no code changes required
- **Platform builders**: Streaming conversations with 50+ messages are now significantly smoother
- **Bundle size**: Zero increase — `React.memo` is a built-in React API

## Related Work

- **T04 (prerequisite)**: Structural sharing provides the reference stability that `React.memo` depends on
- **T02 (instrumentation)**: `useRenderTracer` in dev mode now accurately reflects the memoization — completed components show render count = 1
- **T03 (key stability)**: Stable keys ensure React reconciles memoized components in place (no remount)
- **T06 (next)**: Stream controller state machine will add rAF coalescing, further reducing tick frequency
- **T11 (future)**: Store-backed `ThreadRow` subscriptions deferred here; becomes necessary for virtualization

---

**Status**: Production Ready
**Phase**: 3 of 10 in the React SDK Streaming UX project
