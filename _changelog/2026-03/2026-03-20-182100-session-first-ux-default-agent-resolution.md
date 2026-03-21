# Session-First UX: Default Agent Resolution

**Date**: March 20, 2026

## Summary

Added a `getDefault` query RPC to the Agent service that exposes the platform's default agent concept as a first-class API. Combined with a new `useDefaultAgent` React hook and updated Console `SessionLauncher`, users can now start a conversation without explicitly selecting an agent — the platform default agent (labeled `stigmer.ai/default-agent: "true"`) is used silently, eliminating the "Select an agent before starting a session" error.

## Problem Statement

When a user opened the Stigmer Console, typed a message, and pressed Enter without selecting an agent, they were met with "Select an agent before starting a session." This was a frontend-only guard — the backend already supported default agent resolution via `AgentRepo.findDefault()` (Java) and `store.FindByLabel` (Go). The frontend blocked submission before the backend could exercise this capability.

### Pain Points

- **Friction on the most common path** — The majority of users want to start chatting immediately, not choose an agent first. The error punished users for not doing something they didn't know they needed to do (Nielsen heuristic #5: error prevention).
- **Frontend-backend misalignment** — The proto spec (`SessionSpec.agent_instance_id`) documents that an empty value triggers backend default resolution, but the React SDK's `useCreateSession` hook enforced agent selection at the type level, and `SessionLauncher` threw before reaching the SDK.
- **No API to fetch the default agent** — The backend had `findDefault()` logic but it was only used internally during session/execution creation. No query RPC existed for clients to discover the default agent.

## Solution

A full-stack feature spanning proto, both backends (Java + Go), all SDK codegen targets, a new React hook, and the Console launcher:

1. **Proto**: Added `getDefault(GetDefaultAgentRequest) returns (Agent)` RPC to `AgentQueryController`.
2. **Backends**: Implemented handlers in both Java (`AgentGetDefaultHandler`) and Go (`GetDefault` method on `AgentController`).
3. **Codegen**: `proto2schema` auto-generated the service schema; `make protos` regenerated SDK clients across TypeScript, Go, Python, and Java.
4. **React SDK**: Added `useDefaultAgent(org)` headless data hook that pre-fetches the default agent on mount.
5. **Console**: Updated `SessionLauncher` to use the pre-fetched default agent silently when no agent is explicitly selected.

## Implementation Details

### `apis/ai/stigmer/agentic/agent/v1/io.proto`

- Added `GetDefaultAgentRequest` message with `org` field (org context needed for authorization scoping)

### `apis/ai/stigmer/agentic/agent/v1/query.proto`

- Added `getDefault` RPC to `AgentQueryController` with custom authorization in handler

### `AgentGetDefaultHandler.java` (stigmer-cloud)

- Follows `CustomOperationHandlerV2` pattern (same as `AgentGetByReferenceHandler`)
- Pipeline: ValidateFieldConstraints -> LoadDefaultAgent -> Authorize (FGA can_view) -> TransformResponse -> SendResponse
- `LoadDefaultAgent` calls existing `agentRepo.findDefault()`

### `get_default.go` (stigmer-server)

- Follows Go controller pipeline pattern (same structure as `get_by_reference.go`)
- Custom `loadDefaultAgentStep` calls `store.FindByLabel` with `stigmer.ai/default-agent` label
- Checks `visibility_public` post-load (same pattern as session create handler)

### `sdk/react/src/agent/useDefaultAgent.ts`

- Headless data hook: `useDefaultAgent(org: string | null): UseDefaultAgentReturn`
- Returns `{ agent, isLoading, error, refetch }`
- Fetches on mount, cancels on unmount, supports refetch
- Exported from `@stigmer/react` barrel

### `client-apps/web/src/components/session/SessionLauncher.tsx`

- Removed the `if (!agentRef || !resolution) throw` guard
- Added `useDefaultAgent(org)` to pre-fetch default agent in background
- Restructured `handleSubmit`: if user selected an agent, use their choice; otherwise, use `defaultAgent.status.defaultInstanceId`
- Graceful fallback: if default agent unavailable, shows "No default agent available. Select an agent to start a session."

### UX Design Decision

- The default agent is **invisible** — no chip, no badge, no pre-selection
- The composer stays clean; user just types and sends
- A chip only appears when the user **explicitly** picks a different agent via the picker
- This follows the ChatGPT/Claude model with session-first UX

## Benefits

- **Zero-friction session start** — Users type a message and send. No agent selection required.
- **Backend alignment** — Frontend now mirrors the backend's existing default agent resolution capability.
- **SDK exposure** — Platform builders can use `useDefaultAgent()` to implement their own session-first UX.
- **Clean architecture** — The SDK hook stays strict (requires agent), the Console adds convenience. Each layer has the right opinion.

## Impact

- **Console users** — Immediate improvement: no more "Select an agent" error on first use.
- **SDK consumers** — New `AgentClient.getDefault()` method and `useDefaultAgent` hook available.
- **Proto/API** — New `getDefault` RPC added to `AgentQueryController` (additive, non-breaking).
- **All SDKs** — TypeScript, Go, Python, and Java SDK clients regenerated with `getDefault` method.

## Related Work

- Prerequisite: [Enforce Mutual-Exclusion on Session Creation Input](2026-03-20-105104-enforce-mutual-exclusion-on-session-creation-input.md) — The `useCreateSession` type refactor that surfaced this UX gap
- Backend: `AgentRepo.findDefault()` and `store.FindByLabel` patterns already existed for session/execution creation handlers

---

**Status**: ✅ Production Ready
**Scope**: Proto, Backend (Java + Go), SDK (TS + Go + Python + Java), React SDK, Console
