# Unify Configure Menu Across Home and Session Pages

**Date**: March 21, 2026

## Summary

Unified the SessionComposer Configure menu so that both the home page (session launcher) and the active session page show the same four items: Agent, MCP Servers, Skills, and Secrets. Previously the home page was missing Secrets and the session page was missing Agent. This also introduces mid-session agent switching — a session-level change that updates the agent for all future executions within the conversation.

## Problem Statement

The `SessionComposer` component is shared between the home page and the session page, but each consumer passed different props, causing the Configure menu to show different items in each context.

### Pain Points

- Home page showed Agent, MCP Servers, Skills — but no Secrets
- Session page showed MCP Servers, Skills, Secrets — but no Agent
- Users expected a consistent interface since the same component is used in both places
- No mechanism existed to change agents mid-session, limiting follow-up flexibility

## Solution

Two-phase approach: (1) wire `useOneTimeSecrets` into `SessionLauncher` for Secrets on the home page, and (2) build a new SDK hook plus plumbing to enable agent selection on the session page with session-level persistence.

## Implementation Details

### Phase 1: Secrets on Home Page

Single-file change in `SessionLauncher.tsx`:
- Import and call `useOneTimeSecrets()` hook
- Pass `secrets` prop to `SessionComposer`
- Call `secrets.clear()` after successful session creation

No SDK changes needed — `SessionComposer` already aggregates `secrets.toRuntimeEnv()` into `context.runtimeEnv`, and the launcher already passes `context?.runtimeEnv` to `createExecution`.

### Phase 2: Agent Selection on Session Page

**New SDK hook: `useAgentRefFromSession`**

Chains two API lookups to derive a `ResourceRef` from a session's `agentInstanceId`:
1. `agentInstance.get(instanceId)` → `spec.agentId`
2. `agent.get(agentId)` → `metadata.org` + `metadata.slug`

Uses cancellation to prevent stale state from out-of-order responses.

**Extended `useSessionConversation`**

- Added `agentInstanceId` to `SendFollowUpOptions`
- Extended `buildUpdateInput` to accept and propagate `agentInstanceId` overrides
- Included `agentInstanceId` in the `needsSessionUpdate` check

**Session page wiring**

- Derives `agentRef` from the session's `agentInstanceId` on load
- Manages local `agentRef` + `resolution` state, initialized once from the session
- Passes `agentRef`, `onAgentRefChange`, `onAgentResolutionChange` to `SessionComposer`
- Detects agent changes on submit (`saved` mode compares instance IDs, `direct` mode resolves `defaultInstanceId`) and passes the override to `sendFollowUp`

### End-to-End Flow Verification

The execution relies entirely on the session for skills, MCP servers, and agent — `sendFollowUp` calls `await updateSession(...)` before `create(...)`, so the session is always updated before the execution is created. The agent-runner reads `session.spec.agent_instance_id`, merges `session.spec.skill_refs` with `agent.spec.skill_refs`, and merges `session.spec.mcp_server_usages` with `agent.spec.mcp_server_usages`. No additional wiring was needed.

## Benefits

- Consistent Configure menu across both views (Agent, MCP Servers, Skills, Secrets)
- One-time secrets available for the initial execution, not just follow-ups
- Mid-session agent switching enables multi-agent workflows within a single conversation
- Clean separation: all changes are in consumers and SDK hooks, no changes to `SessionComposer` itself

## Impact

- **SDK**: New `useAgentRefFromSession` hook exported from `@stigmer/react`; `SendFollowUpOptions` extended with `agentInstanceId`
- **Console**: Both `SessionLauncher` and `SessionPage` now pass the full set of Configure menu props
- **Platform builders**: Can now use `sendFollowUp` with `agentInstanceId` to switch agents mid-session

## Related Work

- MCP Server Setup Flow project (20260320.02) — introduced the Secrets Configure menu item and one-time secrets infrastructure
- Agent Picker project — established the agent selection, resolution, and setup flows

---

**Status**: ✅ Production Ready
