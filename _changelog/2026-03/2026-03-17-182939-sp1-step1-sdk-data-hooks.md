# SP1 Step 1: SDK Data Hooks (useSession + useSessionExecutions)

**Date**: March 17, 2026

## Summary

Added `useSession` and `useSessionExecutions` data hooks to `@stigmer/react`, providing the foundational data layer for the session view. These are the first hooks in SP1 (Core Thread + Streaming) and unblock all subsequent steps: streaming, styled components, and the Console session page.

## Problem Statement

The session view at `/sessions/[id]` needs to fetch two resources: the session itself (for metadata like subject and workspace entries) and the executions within it (for the conversation thread). Platform builders embedding Stigmer's session components also need these same data hooks.

### Pain Points

- No SDK hook exists to fetch a session by ID
- No SDK hook exists to list executions for a session
- The Console `SessionPage` is a placeholder with no data fetching

## Solution

Two new data hooks following the established SDK headless-first pattern: fetch data via `useStigmer()`, manage loading/error states, support stale response suppression, and return full proto types.

## Implementation Details

**`useSession(id: string | null)`** — `sdk/react/src/session/useSession.ts`
- Calls `stigmer.session.get(id)` via the generated `SessionClient`
- Returns `{ session: Session | null, isLoading: boolean, error: string | null }`
- `null` parameter produces a stable no-op (no fetch, no loading state)
- Stale response suppression via `cancelled` flag on effect cleanup

**`useSessionExecutions(sessionId: string | null)`** — `sdk/react/src/session/useSessionExecutions.ts`
- Calls `stigmer.agentExecution.listBySession()` via the generated `AgentExecutionClient`
- Returns `{ executions: readonly AgentExecution[], isLoading, error, refetch }`
- Constructs proto request with `create(ListAgentExecutionsBySessionRequestSchema, { sessionId, pageSize: 100 })`
- `refetch()` uses a `fetchKey` counter to re-trigger the effect (needed by SP2 follow-up loop)
- `pageSize: 100` covers all practical session sizes; cursor pagination deferred

**Barrel exports** updated in `sdk/react/src/session/index.ts` and `sdk/react/src/index.ts`.

## Benefits

- Platform builders can fetch session data with a single hook import
- Consistent API surface: `string | null` parameter, `readonly` return types, `error: string | null`
- Zero new dependencies — uses existing `@bufbuild/protobuf` and `@stigmer/protos` peer deps
- Forward-compatible: `refetch()` already exposed for SP2 without future API changes

## Impact

- **SDK (`@stigmer/react`)**: 2 new exports, 2 new type exports
- **Console**: No changes yet — SessionPage will consume these hooks in Step 4
- **Platform builders**: Can now build custom session views using `useSession` + `useSessionExecutions`

## Related Work

- Part of SP1 (20260317.02.sp.core-thread-streaming) — Step 1 of 5
- Parent project: 20260317.01.session-first-web-ux (T01.6)
- Next: Step 2 (`useExecutionStream` — streaming subscription hook)

---

**Status**: Production Ready
**Timeline**: Single session
