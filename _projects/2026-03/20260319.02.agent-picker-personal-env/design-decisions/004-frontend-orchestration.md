# Design Decision 004: Frontend Orchestration, Not Backend Side Effects

**Date**: 2026-03-19
**Status**: Accepted

## Context

When a user picks an agent that requires credentials and has no personal instance, the system needs to create a personal Environment and a personal AgentInstance before creating the Session. The question: should the backend handle this automatically inside `session.create()`, or should the frontend orchestrate separate API calls?

## Decision

**Frontend orchestrates. Backend stays clean.**

Each backend API does exactly one thing:
- `environment.create()` creates an Environment
- `agentInstance.create()` creates an AgentInstance
- `session.create()` creates a Session
- `execution.create()` creates an AgentExecution

No hidden side effects. No cross-aggregate creation inside a single command handler.

The multi-step provisioning flow (get-or-create environment, get-or-create instance, create session) is application-layer orchestration. It lives in:
- **React SDK**: `usePersonalAgentInstance` hook (for direct Stigmer users)
- **CLI**: Equivalent Go function (for CLI users)
- **Platform builders**: They pre-provision via API; they don't use the personal flow at all.

## Rationale

1. **Aggregate boundary integrity**: Session, AgentInstance, and Environment are separate aggregates. Cross-aggregate orchestration belongs in the application layer, not inside a single aggregate's command handler.

2. **Command clarity**: `session.create()` should create a session. Period. A consumer should not wonder "does this sometimes also create an Environment?"

3. **Platform-for-platforms**: Platform builders who pre-provision agents via their backend don't want `session.create()` to randomly create Environments. Clean APIs compose. Magic APIs surprise.

4. **Debuggability**: When the frontend calls three separate APIs in sequence, a failure is immediately traceable to the exact step that failed. A backend that creates three resources in one call hides failure modes.

## What does NOT change

- `Session` does not carry env vars. It carries `agent_instance_id`.
- `runtime_env` on AgentExecution stays for per-execution overrides (ephemeral, single-run). Separate concern from persistent credentials.
- Backend aggregate command handlers remain single-responsibility.

## Consequences

- The personal provisioning flow is consumer-side logic, not server-side magic
- The React SDK provides hooks for this flow; the CLI provides equivalent commands
- Platform builders bypass the personal flow entirely and use the raw APIs directly
