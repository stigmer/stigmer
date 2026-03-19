# Console Agent Picker Integration (T01.11 — Phase 1 Complete)

**Date**: March 19, 2026

## Summary

Wired agent selection into the Console's SessionLauncher, completing Phase 1 of the agent-picker-personal-env project. The agent picker is now functional end-to-end: users can select an agent from the SessionComposer toolbar, and the selected agent's default instance is resolved during session creation.

## Problem Statement

The SessionComposer SDK component already accepted `agentRef` / `onAgentRefChange` props (T01.9), and `useCreateSession` already supported `agentRef` resolution (T01.10), but the Console's SessionLauncher — the landing page widget — was not yet passing agent state through, leaving the agent picker invisible to Console users.

### Pain Points

- Agent picker trigger did not appear in the Console's session launcher toolbar
- No way for Console users to select an agent when starting a new session
- Phase 1 SDK work (T01.1–T01.10) was complete but not surfaced to end users

## Solution

Added `agentRef` state management to `SessionLauncher` and connected it to the existing SDK surface — three integration points in a single file.

## Implementation Details

**File**: `client-apps/web/src/components/session/SessionLauncher.tsx` (+5 lines)

1. **State**: `useState<ResourceRef | null>(null)` for `agentRef`, grouped with other context state
2. **Composer props**: `agentRef={agentRef}` and `onAgentRefChange={setAgentRef}` passed to `SessionComposer`
3. **Session creation**: `agentRef: agentRef ?? undefined` forwarded to `createSession()` — the `?? undefined` coercion bridges `null` (React state) to `undefined` (SDK input type)
4. **Dependencies**: `agentRef` added to `handleSubmit` useCallback dependency array

No new imports required — `ResourceRef` was already imported from `@stigmer/sdk`.

## Benefits

- Console users can now select an agent from the session launcher toolbar
- Agent selection resolves to the agent's default instance via `useCreateSession`'s existing resolution logic
- Error handling for agents without default instances flows through the existing catch/toast pattern
- Zero additional complexity — pure wiring, no new abstractions

## Impact

- **Console users**: Agent picker is now visible and functional in the session launcher
- **Phase 1 milestone**: All 11 tasks (T01.1–T01.11) are complete. The full Layer 1 building-block surface is shipped:
  - `useAgentSearch`, `AgentPicker`, `useEnvironment`, `useCreateEnvironment`, `useUpdateEnvironment`, `useAgentInstance`, `useCreateAgentInstance` (hooks/components)
  - `SessionComposer` with agent props, `useCreateSession` with agent resolution
  - All importable from `@stigmer/react`

## Related Work

- T01.9: SessionComposer agent integration (SDK side)
- T01.10: useCreateSession agent wiring (SDK side)
- Phase 2 (T02.1–T02.5): Personal environment orchestration (next major milestone)
- Phase 3 (T03.1–T03.3): Backend env_spec whitelist filtering (security prerequisite for Phase 2)

---

**Status**: ✅ Production Ready
**Timeline**: Phase 1 complete across 11 sessions (2026-03-19)
