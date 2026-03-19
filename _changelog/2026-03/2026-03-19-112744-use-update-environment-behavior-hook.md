# useUpdateEnvironment Behavior Hook — Environment Update for Platform Builders

**Date**: March 19, 2026

## Summary

Added the `useUpdateEnvironment` behavior hook to `@stigmer/react` — a Layer 1 building-block hook that wraps `stigmer.environment.update()` with loading/error state management. It mirrors the structure of `useCreateEnvironment` and `useUpdateSession`, giving platform builders a typed mutation hook for updating existing environments. Phase 2’s `usePersonalEnvironment` will compose this hook for the `addVariables` flow.

## Problem Statement

The agent-picker personal-environment project (Phase 1) needs both create and update behavior hooks for Environment resources. The Phase 2 orchestration hook (`usePersonalEnvironment`) must support “get or create personal env, then add variables” — adding variables is an update to the existing environment. Without a dedicated update hook, callers would manage loading/error state manually around `stigmer.environment.update()`.

### Pain Points

- No hook for updating Environment resources
- Layer 2 `usePersonalEnvironment.addVariables()` needs a composable update building block
- Inconsistent SDK surface if create exists but update does not

## Solution

Implemented `useUpdateEnvironment()` to match the existing behavior-hook pattern: same `EnvironmentInput` from `@stigmer/sdk`, same return shape (`update`, `isUpdating`, `error`, `clearError`), and full `Environment` proto returned so callers get the latest server state.

## Implementation Details

- **File**: `sdk/react/src/environment/useUpdateEnvironment.ts` (~75 lines)
- **Barrel**: `sdk/react/src/environment/index.ts` — added `useUpdateEnvironment` and `UseUpdateEnvironmentReturn`
- **Input**: `EnvironmentInput` from `@stigmer/sdk` (same as create — backend identifies resource by name/org)
- **Output**: `{ update, isUpdating, error, clearError }`
- **Return type of `update`**: `Promise<Environment>`
- **Error fallback**: `"Failed to update environment"`
- **Pattern**: Identical to `useCreateEnvironment` and `useUpdateSession` — `useState` for loading/error, `useCallback` for mutation, try/catch/finally

### Design Decisions

- **No new types**: Reuses `EnvironmentInput`; the SDK’s `environment.update()` already accepts the same input as `create()`.
- **Full proto return**: Callers receive updated metadata (version, timestamps) for immediate reference.
- **JSDoc**: Documents Layer 1 building-block role and points to `usePersonalEnvironment` for the direct-user flow.

## Benefits

- Platform builders can update environments with consistent loading/error handling
- API symmetry with `useCreateEnvironment` — same input type, parallel return shape
- Ready for Phase 2 composition in `usePersonalEnvironment.addVariables()`

## Impact

- **SDK surface**: New exports from `sdk/react/src/environment/index.ts` (main barrel update deferred to T01.8)
- **Profiles served**: Profile A (Platform Builders) as Layer 1 building block
- **Phase 2 foundation**: Required for personal environment “add variables” flow

## Related Work

- Part of project `20260319.02.agent-picker-personal-env` (Phase 1, T01.5)
- Follows `useCreateEnvironment` (T01.4) and `useUpdateSession` pattern
- Next: T01.6 `useAgentInstance` data hook

---

**Status**: Production Ready
**Timeline**: 1 session
