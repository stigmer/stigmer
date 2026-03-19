# useEnvironment Data Hook — First ResourceRef-Based Fetch Hook

**Date**: March 19, 2026

## Summary

Added the `useEnvironment` data hook to `@stigmer/react` — a Layer 1 building-block hook that fetches a single Environment resource by `ResourceRef`. This is the first hook in the SDK that uses `getByReference` instead of `get(id)`, establishing the pattern for upcoming hooks like `useAgentInstance`.

## Problem Statement

The agent-picker personal-environment project (Phase 1) requires building-block hooks for Environment resources. Platform builders need a clean, typed hook to fetch environment data by org/slug reference. The Phase 2 orchestration hook (`usePersonalEnvironment`) will compose this hook for the "personal environment" flow.

### Pain Points

- No existing hook for fetching Environment resources
- No established pattern for `ResourceRef`-based fetching (only `string` ID fetching via `useSession`)
- The upcoming `useAgentInstance` hook needs the same `ResourceRef` pattern

## Solution

Created `useEnvironment(ref: ResourceRef | null)` following the existing `useSession` pattern with two key additions: `ResourceRef` input (with primitive destructuring for stable deps) and `refetch()` capability.

## Implementation Details

- **File**: `sdk/react/src/environment/useEnvironment.ts` (~87 lines)
- **Barrel**: `sdk/react/src/environment/index.ts`
- **Input**: `ResourceRef | null` — pass `null` to skip fetching (consistent with `useSession(null)`)
- **Output**: `{ environment, isLoading, error, refetch }`
- **Key pattern**: Destructures `ref` into `org`, `slug`, `version` primitives for `useEffect` dependency array, preventing infinite re-fetches from object identity changes
- **Cancellation**: Same `cancelled.current` pattern as `useSession`
- **Refetch**: `fetchKey` increment pattern from `useSessionList`

## Benefits

- Platform builders can fetch environment data with a single hook call
- Clean `ResourceRef`-based API that matches how resources are identified across the platform
- `refetch()` enables the Phase 2 orchestration hook to re-query after mutations
- Establishes reusable pattern for `useAgentInstance` (T01.6)

## Impact

- **SDK surface**: New exports `useEnvironment` and `UseEnvironmentReturn` (not yet in main barrel — deferred to T01.8)
- **Profiles served**: Profile A (Platform Builders) as Layer 1 building block
- **Phase 2 foundation**: `usePersonalEnvironment` will compose this hook

## Related Work

- Part of project `20260319.02.agent-picker-personal-env` (Phase 1, T01.3)
- Follows `useSession` pattern from session module
- Preceded by `useAgentSearch` (T01.1) and `AgentPicker` (T01.2)
- Next: `useCreateEnvironment` (T01.4) and `useUpdateEnvironment` (T01.5)

---

**Status**: Production Ready
**Timeline**: 1 session
