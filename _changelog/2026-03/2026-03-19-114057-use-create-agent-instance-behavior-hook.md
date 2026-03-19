# useCreateAgentInstance Behavior Hook — Agent Instance Provisioning for Platform Builders

**Date**: March 19, 2026

## Summary

Added the `useCreateAgentInstance` behavior hook to `@stigmer/react` — a Layer 1 building-block hook wrapping `stigmer.agentInstance.create()` with loading/error state. This is the last new hook in Phase 1 of the agent-picker project. It follows the `useCreateEnvironment` pattern exactly and will be composed by Phase 2's `usePersonalAgentInstance` for the get-or-create personal instance flow.

## Problem Statement

The agent-picker personal-environment project (Phase 1) needs a behavior hook for creating AgentInstance resources. Platform builders who provision agent instances programmatically need a hook with consistent loading/error state management. Phase 2's `usePersonalAgentInstance` needs this as a composable building block for the "create personal instance if it doesn't exist" step.

### Pain Points

- No hook for creating AgentInstance resources with managed loading/error state
- Platform builders would need to call `stigmer.agentInstance.create()` directly and manage their own state
- Layer 2 `usePersonalAgentInstance.getOrCreate()` needs a composable create building block

## Solution

Implemented `useCreateAgentInstance()` following the established behavior hook pattern from `useCreateEnvironment`: no parameters, returns `{ create, isCreating, error, clearError }`, wraps a single SDK client call in `useCallback` with `useState` for loading and error state, rethrows on failure so callers can handle errors in their own try/catch.

## Implementation Details

- **File**: `sdk/react/src/agent-instance/useCreateAgentInstance.ts` (~80 lines)
- **Barrel**: `sdk/react/src/agent-instance/index.ts` — added `useCreateAgentInstance` and `UseCreateAgentInstanceReturn` exports
- **Input**: `AgentInstanceInput` from `@stigmer/sdk` (fields: `name`, `org`, optional `agentId`, `description`, `environmentRefs`)
- **Output**: `{ create, isCreating, error, clearError }`
- **SDK method**: `stigmer.agentInstance.create(input)`
- **Error fallback**: `"Failed to create agent instance"`
- **Proto type**: `AgentInstance` from `@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb`

### Pattern Consistency

This is the fifth behavior hook following the same structural pattern:
1. `useCreateEnvironment` — `stigmer.environment.create()`
2. `useUpdateEnvironment` — `stigmer.environment.update()`
3. `useUpdateSession` — `stigmer.session.update()`
4. `useCreateSession` — `stigmer.session.create()`
5. `useCreateAgentInstance` — `stigmer.agentInstance.create()`

All share: no parameters, `useCallback`-wrapped async mutation, `useState` for loading/error, rethrow on failure, `clearError` callback.

## Benefits

- Platform builders can create agent instances with consistent loading/error handling
- Completes all seven Layer 1 hooks for Phase 1 (T01.1–T01.7)
- Enables Phase 2 personal instance provisioning without additional state management

## Impact

- **SDK surface**: New hook added to `sdk/react/src/agent-instance/` barrel (main barrel update deferred to T01.8)
- **Profiles served**: Profile A (Platform Builders) as Layer 1 building block
- **Phase 1 progress**: All new hooks complete; remaining tasks (T01.8–T01.11) are integration/wiring

## Related Work

- Part of project `20260319.02.agent-picker-personal-env` (Phase 1, T01.7)
- Follows `useCreateEnvironment` (T01.4) pattern exactly
- Complements `useAgentInstance` (T01.6) data hook in the same module
- Next: T01.8 barrel exports, T01.9 SessionComposer integration

---

**Status**: Production Ready
**Timeline**: 1 session
