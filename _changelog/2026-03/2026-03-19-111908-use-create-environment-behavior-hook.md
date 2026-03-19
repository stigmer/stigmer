# useCreateEnvironment Behavior Hook — Environment Creation for Platform Builders

**Date**: March 19, 2026

## Summary

Added the `useCreateEnvironment` behavior hook to `@stigmer/react` — a Layer 1 building-block hook that wraps `stigmer.environment.create()` with loading/error state management. This follows the established behavior hook pattern (`useUpdateSession`, `useCreateSession`) and gives platform builders a clean, typed mutation hook for provisioning environments programmatically.

## Problem Statement

The agent-picker personal-environment project (Phase 1) requires behavior hooks for Environment resources alongside the data hook (`useEnvironment`) shipped in the previous session. Platform builders need typed mutation hooks to create and update environments. The Phase 2 orchestration hook (`usePersonalEnvironment`) will compose these building blocks for the "direct user" flow.

### Pain Points

- No existing hook for creating Environment resources
- Platform builders would need to manually manage loading/error state when calling the SDK client directly
- The Layer 2 orchestration hook needs a composable building block for the get-or-create flow

## Solution

Created `useCreateEnvironment()` following the `useUpdateSession` pattern exactly — uses `EnvironmentInput` from `@stigmer/sdk` directly (no wrapper type), returns the full `Environment` proto, and manages `isCreating` / `error` / `clearError` state.

## Implementation Details

- **File**: `sdk/react/src/environment/useCreateEnvironment.ts` (~75 lines)
- **Barrel**: `sdk/react/src/environment/index.ts` (updated)
- **Input**: `EnvironmentInput` from `@stigmer/sdk` — `{ name, org, description?, data? }`
- **Output**: `{ create, isCreating, error, clearError }`
- **Return type of `create`**: `Promise<Environment>` — full proto with server-generated metadata
- **Error fallback**: `"Failed to create environment"`
- **Pattern**: Identical to `useUpdateSession` — `useState` for loading/error, `useCallback` for mutation, try/catch/finally

### Design Decisions

- **No wrapper type**: `EnvironmentInput` is already well-shaped and is the type platform builders know from the SDK. Adding a `CreateEnvironmentInput` wrapper would be indirection without value.
- **Full proto return**: Callers get immediate access to `metadata.id`, version, timestamps. The Layer 2 hook needs this to extract the resource reference.
- **No auto-naming**: Unlike sessions (ephemeral, auto-named), environments are named resources with semantic identifiers chosen by the caller. The "personal" convention belongs in Layer 2.

## Benefits

- Platform builders can create environments with a single hook call and get automatic loading/error state
- Consistent API shape with all existing behavior hooks (`useCreateSession`, `useUpdateSession`, `useCreateAgentExecution`)
- Composable building block for the Phase 2 orchestration layer

## Impact

- **SDK surface**: New exports `useCreateEnvironment` and `UseCreateEnvironmentReturn` (not yet in main barrel — deferred to T01.8)
- **Profiles served**: Profile A (Platform Builders) as Layer 1 building block
- **Phase 2 foundation**: `usePersonalEnvironment` will compose this hook for get-or-create flow

## Related Work

- Part of project `20260319.02.agent-picker-personal-env` (Phase 1, T01.4)
- Follows `useUpdateSession` pattern from session module
- Preceded by `useEnvironment` data hook (T01.3)
- Next: `useUpdateEnvironment` (T01.5) — structurally identical, wraps `update()` instead of `create()`

---

**Status**: Production Ready
**Timeline**: 1 session
