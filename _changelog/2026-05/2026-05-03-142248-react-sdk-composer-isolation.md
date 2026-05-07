# React SDK: Composer Isolation via React.memo and Hook Return Stabilization (T09)

**Date**: May 3, 2026

## Summary

Isolated `SessionComposer` from streaming re-renders by wrapping it in `React.memo` and stabilizing all props that were previously unstable during token streaming. The composer now skips re-renders entirely during active streaming, eliminating unnecessary work (~60 re-renders/second) and ensuring zero input lag in the textarea.

## Problem Statement

During token streaming, `SessionPageInner` re-renders on every animation frame (rAF-coalesced via the T06 stream controller). Because `MessageThread` and `SessionComposer` are siblings in the same parent, the composer re-rendered ~60 times per second despite having no streaming-related state. This wasted CPU cycles and could cause input lag on mid-tier hardware.

### Pain Points

- `SessionComposer` (1632 lines, 8+ internal hooks) re-rendered on every streaming frame
- `handleSubmit` callback was recreated every frame because its `useCallback` depended on `conv` (the entire conversation object, which is a new reference every render)
- Three hook return objects (`useWorkspaceEntries`, `useSessionVariables`, `useGitHubConnection`) returned new container references on every render even when their internal values hadn't changed
- Simply wrapping `SessionComposer` in `React.memo` was insufficient — shallow comparison failed on 4 unstable props

## Solution

Fixed the problem at the source by stabilizing each hook's return value and narrowing callback dependencies, rather than hacking around it at the call site or writing a brittle custom `areEqual` comparator.

## Implementation Details

### 1. Narrowed `handleSubmit` dependencies (`useSessionPageFlow.ts`)

The `useCallback` for `handleSubmit` depended on `conv` (the full conversation return object, new every frame during streaming). The function body only uses `conv.sendFollowUp()` and `sessionVariables.clear()`. Narrowed deps to the specific methods:

```
Before: [conv, modelId, workspace, ..., sessionVariables, ...]
After:  [conv.sendFollowUp, modelId, workspace, ..., sessionVariables.clear, ...]
```

`sendFollowUp` is itself a `useCallback` with deps stable during streaming (`sessionId`, `session`, `org`, etc.).

### 2. Stabilized hook return objects (3 hooks)

Wrapped the return object of each hook in `useMemo` so the container reference is stable when internal values haven't changed:

- **`useWorkspaceEntries`** — all callbacks already `useCallback`'d; added `useMemo` on the return
- **`useSessionVariables`** — same pattern; hoisted inline `isEmpty` to a local for the memo dep array
- **`useGitHubConnection`** — same pattern; hoisted inline `isConnected` to a local

### 3. Wrapped `SessionComposer` in `React.memo`

Changed from `export function SessionComposer` to `export const SessionComposer = memo(function SessionComposer(...) { ... })`. No custom comparator needed — default shallow comparison works now that all props are stable.

`useRenderTracer("SessionComposer", ...)` was already present from T02, providing dev-time verification.

### 4. Tests (13 new, 408 total)

- 5 `useWorkspaceEntries` return reference stability tests
- 6 `useSessionVariables` return reference stability tests
- 2 `SessionComposer` memo structural verification tests

## Benefits

- **Zero composer re-renders during streaming** — only re-renders at execution lifecycle boundaries (start, complete)
- **Responsive textarea** — no input lag from unnecessary re-renders during token streaming
- **General improvement** — hook return stabilization benefits ALL consumers of `useWorkspaceEntries`, `useSessionVariables`, and `useGitHubConnection`, not just the session page
- **No public API changes** — `SessionComposerProps` interface unchanged
- **No new dependencies** — pure React patterns (`memo`, `useMemo`, `useCallback`)

## Impact

- **SDK consumers**: `SessionComposer` is now a memoized component. Consumers that pass stable props automatically benefit from skip-re-render optimization.
- **Platform builders**: The three stabilized hooks return stable references, making them safe to use as `useEffect` / `useMemo` / `useCallback` dependencies without unnecessary invalidation.
- **Streaming UX project (T02–T12)**: T09 completes phase 7 of 11. Combined with T06 (rAF coalescing + `startTransition`) and T05 (leaf component memoization), the entire streaming render path is now optimized — only the actively changing assistant message row re-renders during streaming.

## Files Changed

| File | Change |
|------|--------|
| `sdk/react/src/session/useSessionPageFlow.ts` | Narrowed `handleSubmit` deps from `conv` to `conv.sendFollowUp` |
| `sdk/react/src/workspace/useWorkspaceEntries.ts` | Added `useMemo` to stabilize return object |
| `sdk/react/src/execution/useSessionVariables.ts` | Added `useMemo` to stabilize return object |
| `sdk/react/src/github/useGitHubConnection.ts` | Added `useMemo` to stabilize return object |
| `sdk/react/src/composer/SessionComposer.tsx` | Wrapped in `React.memo` |
| `sdk/react/src/workspace/__tests__/useWorkspaceEntries-stability.test.ts` | New: 5 return stability tests |
| `sdk/react/src/execution/__tests__/useSessionVariables-stability.test.ts` | New: 6 return stability tests |
| `sdk/react/src/composer/__tests__/SessionComposer-memo.test.ts` | New: 2 memo structure tests |

## Related Work

- **T02**: Dev instrumentation (`useRenderTracer`) — used to verify isolation
- **T05**: Row-level memoization (`React.memo` on `MessageEntry`, `ToolCallGroup`, etc.)
- **T06**: Stream controller with rAF coalescing + `startTransition`
- **T08**: `FetchCache` for flicker-free session navigation
- **Next**: T10 (Auto-Scroll State Machine), T11 (Virtualization), T12 (Animation & Polish)

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
