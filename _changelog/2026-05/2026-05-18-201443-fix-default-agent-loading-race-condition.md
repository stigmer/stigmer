# Fix Default Agent Loading Race Condition

**Date**: May 18, 2026

## Summary

Fixed a race condition in the React SDK where submitting a message before the `getDefault` agent fetch resolved would immediately throw "Loading default agent. Please try again in a moment." The submit flow now awaits the in-flight fetch with a 10-second timeout, eliminating the error for normal network latency.

## Problem Statement

When a user opens the desktop or web app and submits a message quickly, the `useNewSessionFlow.submit` callback checks for `defaultAgent.status.defaultInstanceId`. If `useDefaultAgent` hasn't resolved yet, it throws immediately — turning a predictable timing issue into a user-facing error.

### Pain Points

- Users who type and submit quickly see a cryptic red error
- The textarea clears on submit (optimistic), so the user loses their message
- The error requires manual retry with no indication of when it's safe to try again
- Both desktop and web apps affected (shared SDK hook)

## Solution

Two-part fix in `@stigmer/react` (SDK-first, DD-001), automatically benefiting both client apps (DD-016 parity):

1. **`useDefaultAgent` exposes `waitForResolution()`** — a deferred-pattern method that returns a `Promise<Agent>` resolving when the in-flight fetch settles
2. **`useNewSessionFlow.submit` awaits the resolution** instead of throwing when the default agent is still loading

## Implementation Details

### `sdk/react/src/agent/useDefaultAgent.ts`

- Added `Deferred<T>` type and `createDeferred<T>()` helper
- `deferredRef` tracks the pending promise; resolved/rejected via `useEffect` on `agent`/`error` state changes
- `waitForResolution()` returns immediately if agent is loaded or errored, otherwise returns the deferred promise
- Exported on `UseDefaultAgentReturn` interface

### `sdk/react/src/internal/withTimeout.ts` (new)

- Internal utility: races a promise against a timer, rejects with a descriptive message on timeout
- Not exported from the SDK barrel

### `sdk/react/src/session/useNewSessionFlow.ts`

- Import `withTimeout` and destructure `waitForDefaultAgent` from `useDefaultAgent`
- In `submit`, when `isDefaultAgentLoading` is true: await `withTimeout(waitForDefaultAgent(), 10_000, ...)`
- If resolved: use the `defaultInstanceId` from the resolved agent
- If timeout: throw "Default agent did not load in time. Please try again."
- If already errored (not loading): throw "Failed to load default agent. Please try again."

### Tests

- `useDefaultAgent.test.tsx`: 4 new tests for `waitForResolution` (immediate resolve, deferred resolve, fetch failure, already-errored)
- `useNewSessionFlow.test.tsx`: 4 new tests for submit-while-loading (await success, fetch failure, timeout via fake timers, already-failed immediate error)
- `session-launcher.spec.ts`: E2E smoke test — submit immediately after page load, assert no loading/failure errors

## Benefits

- Users can type and submit at any speed — the system handles timing internally
- The existing `isSubmitting` → spinner UX communicates "working..." during the brief wait
- 10-second timeout as safety net for genuinely broken backends
- 511 tests pass, TypeScript compiles cleanly across sdk/react, desktop, and web

## Impact

- **Files changed**: 6 (3 production, 3 test)
- **SDK public API**: `UseDefaultAgentReturn.waitForResolution` added (non-breaking)
- **Client apps**: Zero changes needed (DD-016 parity via shared SDK)
- **Test count**: 511 pass in sdk/react (+8 new), 0 fail

## Related Work

- Builds on `2026-05-18-163720-getdefault-agent-integration-test-coverage.md` which added backend integration tests for the `getDefault` RPC
- The actual "Failed to load" error turned out to be a separate FGA authorization issue (missing wildcard viewer tuples), fixed via direct FGA tuple writes — see `stigmer-cloud/_changelog/2026-05/2026-05-18-fga-public-visibility-tuples-investigation.md`

---

**Status**: Production Ready
**Timeline**: Single session
