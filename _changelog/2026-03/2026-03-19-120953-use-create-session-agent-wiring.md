# useCreateSession Agent Wiring

**Date**: March 19, 2026

## Summary

Extended the `useCreateSession` hook to accept agent selection, enabling session creation against a specific agent or agent instance. The hook now supports three resolution strategies — explicit instance ID, agent reference (resolved to default instance), and platform default — serving both platform builders and direct users.

## Problem Statement

The `useCreateSession` hook in `@stigmer/react` had no way to specify which agent a session should use. The underlying `SessionInput` in `@stigmer/sdk` already supported `agentInstanceId`, but the React hook's `CreateSessionInput` never exposed it.

### Pain Points

- Platform builders could not pass a pre-provisioned `agentInstanceId` through the hook
- The AgentPicker (completed in T01.9) could select an agent, but there was no way to wire that selection into session creation
- The gap between "user picks an agent" and "session runs against that agent" was unresolved

## Solution

Extended `CreateSessionInput` with two new optional fields and added agent instance resolution logic inside the `create()` callback.

## Implementation Details

Single file modified: `sdk/react/src/session/useCreateSession.ts` (+65 lines).

**New fields on `CreateSessionInput`:**
- `agentInstanceId?: string` — direct pass-through for platform builders who pre-provision instances
- `agentRef?: ResourceRef` — convenience path that resolves the agent's default instance via `agent.getByReference()`

**Resolution priority (inside `create()`):**
1. `agentInstanceId` provided → use directly
2. `agentRef` provided → call `agent.getByReference()` → extract `status.defaultInstanceId`
3. Neither provided → omit, backend resolves platform default

**Defensive error handling:**
- If an agent is resolved but has no `defaultInstanceId`: `"Agent 'org/slug' does not have a default instance. Pass an explicit agentInstanceId instead."`

**JSDoc:**
- Documents all three resolution strategies with numbered priority
- Three `@example` blocks: platform builder path, agent reference path, platform default path
- Inline field JSDoc with `{@link}` cross-references between `agentInstanceId` and `agentRef`

## Benefits

- Platform builders can now pass `agentInstanceId` directly when creating sessions
- Consumers who know agent slugs but not instance IDs get automatic resolution
- The hook remains backward-compatible — existing callers are unaffected
- Phase 2 orchestration hooks will bypass `agentRef` resolution entirely, passing `agentInstanceId` directly after personal instance creation

## Impact

- **Platform builders**: Can now create sessions against specific agent instances via `useCreateSession`
- **Console/direct users**: The session creation path from AgentPicker → useCreateSession is now wired (T01.11 will complete the Console integration)
- **Phase 2 readiness**: The `agentInstanceId` field is the handoff point for the personal instance flow

## Related Work

- T01.9: SessionComposer AgentPicker integration (provides `agentRef` from user selection)
- T01.11: Console integration (will wire `agentRef` state in SessionLauncher)
- Phase 2: `usePersonalAgentInstance` will resolve to `agentInstanceId` before calling `createSession`

---

**Status**: Production Ready
**Scope**: T01.10 of the agent-picker-personal-env project (Phase 1)
