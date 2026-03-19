# useAgentInstance Data Hook — AgentInstance Fetching for Platform Builders

**Date**: March 19, 2026

## Summary

Added the `useAgentInstance` data hook to `@stigmer/react` — a Layer 1 building-block hook that fetches a single `AgentInstance` by `ResourceRef`. It follows the `useEnvironment` pattern exactly, creating the new `agent-instance` module in the React SDK. Phase 2's `usePersonalAgentInstance` will compose this hook for the get-or-create personal instance flow.

## Problem Statement

The agent-picker personal-environment project (Phase 1) needs a data hook for fetching individual AgentInstance resources by reference. Platform builders who pre-provision agent instances need to query them by org/slug. The Phase 2 orchestration hook (`usePersonalAgentInstance`) needs this as a composable building block for the "check if personal instance exists" step.

### Pain Points

- No hook for fetching a single AgentInstance by reference
- Layer 2 `usePersonalAgentInstance.getOrCreate()` needs a composable fetch building block
- The `agent-instance` module did not exist in the React SDK

## Solution

Implemented `useAgentInstance()` following the established `useEnvironment` pattern: `ResourceRef | null` input, primitive destructuring for `useEffect` deps, cancellation flag for stale response handling, and `refetch()` via `fetchKey` increment.

## Implementation Details

- **File**: `sdk/react/src/agent-instance/useAgentInstance.ts` (~85 lines)
- **Barrel**: `sdk/react/src/agent-instance/index.ts` — exports `useAgentInstance` and `UseAgentInstanceReturn`
- **Input**: `ResourceRef | null` (null skips fetch, consistent with `useEnvironment(null)`)
- **Output**: `{ agentInstance, isLoading, error, refetch }`
- **SDK method**: `stigmer.agentInstance.getByReference({ org, slug, version })`
- **Error fallback**: `"Failed to load agent instance"`
- **Proto type**: `AgentInstance` from `@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb`

### Design Decisions

- **Return property `agentInstance`**: Plan originally specified `instance`, but this was changed to maintain the naming convention where every data hook returns the full domain noun (`session`, `environment`, `agentInstance`). Using `instance` alone is ambiguous and breaks pattern consistency for platform builders who destructure multiple hooks.
- **`refetch()` included**: Unlike `useSession` which has no `refetch()`, this hook includes it (same as `useEnvironment`) because Phase 2's `usePersonalAgentInstance` needs to re-query after creating a new instance.
- **JSDoc**: Documents Layer 1 building-block role and cross-references `usePersonalAgentInstance` for the direct-user flow.

## Benefits

- Platform builders can fetch agent instances by reference with consistent loading/error handling
- New `agent-instance` module establishes the directory structure for T01.7 (`useCreateAgentInstance`)
- `refetch()` enables Phase 2 orchestration without additional fetch logic

## Impact

- **SDK surface**: New module `sdk/react/src/agent-instance/` with barrel exports (main barrel update deferred to T01.8)
- **Profiles served**: Profile A (Platform Builders) as Layer 1 building block
- **Phase 2 foundation**: Required for personal agent instance get-or-create flow

## Related Work

- Part of project `20260319.02.agent-picker-personal-env` (Phase 1, T01.6)
- Follows `useEnvironment` (T01.3) pattern exactly
- Next: T01.7 `useCreateAgentInstance` behavior hook

---

**Status**: Production Ready
**Timeline**: 1 session
