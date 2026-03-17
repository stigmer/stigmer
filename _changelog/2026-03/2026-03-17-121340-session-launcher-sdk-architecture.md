# Session Launcher with Headless-First SDK Architecture

**Date**: March 17, 2026

## Summary

Built the new session launcher (T01.5) as the web console's landing page, backed by a full headless-first SDK architecture in `@stigmer/react`. Users can now type a message, optionally select a model and workspace entries, and start a session — the backend resolves the default agent automatically. The SDK components follow a three-layer pattern (data hooks, behavior hooks, styled components) designed for platform-for-platforms reuse.

## Problem Statement

The web console needed a "new session" launcher as its primary landing page — the first interactive surface users see after login. This required:

### Pain Points

- No SDK components existed for session/execution creation after the T01.3 teardown
- The backend required `agent_instance_id` when creating sessions, but the frontend doesn't know (or care) which agent instance to use for the default flow
- No model selection UI existed — the model list lives in the Python backend with no RPC to expose it
- The React SDK had no established pattern for headless-first, three-layer component architecture

## Solution

Designed and implemented a three-layer SDK architecture where each layer has clear responsibilities and boundaries. Data hooks provide raw data, behavior hooks wrap SDK calls with React state lifecycle, and styled components compose hooks into visible UI. Console-specific concerns (org context, routing, notifications) stay in the Console — not the SDK.

Made `agent_instance_id` optional in the Session proto. The backend resolves the default agent instance when the field is omitted, implemented as pipeline steps in both Go and Java backends.

## Implementation Details

### SDK Modules (`@stigmer/react`)

**Models module** (`src/models/`):
- `registry.ts` — 22 models hardcoded from Python `model_registry.py` with provider, cost tier, and metadata
- `useModelRegistry()` — data hook grouping models by provider, providing defaults and lookup helpers
- `<ModelSelector>` — styled dropdown using `@base-ui/react` Select, themed with `--stgm-*` tokens

**Workspace module** (`src/workspace/`):
- `useWorkspaceEntries()` — behavior hook managing an array of workspace entries (add/remove, name derivation, SDK input conversion)
- `<WorkspaceEditor>` — styled component for adding/removing workspace entries

**Session module** (`src/session/`):
- `useCreateSession()` — behavior hook wrapping `stigmer.session.create()` with loading/error state. Maps 1:1 to the Session aggregate.

**Execution module** (`src/execution/`):
- `useCreateAgentExecution()` — behavior hook wrapping `stigmer.agentExecution.create()` with loading/error state. Maps 1:1 to the AgentExecution aggregate. Named with `Agent` qualifier to disambiguate from future workflow executions.

### Backend Changes

**Proto** (`apis/ai/stigmer/agentic/session/v1/spec.proto`):
- `agent_instance_id` changed from required to optional in `SessionSpec`

**Go** (`backend/services/stigmer-server/`):
- `resolveDefaultAgentInstanceStep` added to session creation pipeline
- `SessionController` gains `agentClient` and `agentInstanceClient` via `SetClients()`

**Java** (`stigmer-cloud`):
- `ResolveDefaultAgentInstanceStep` inner class in `SessionCreateHandler`

### Console Integration

- `SessionLauncher` component composes SDK hooks with Console-specific `useActiveOrgSlug`, `useRouter`, and `toast`
- Two-step flow: `useCreateSession()` -> `useCreateAgentExecution()` -> navigate to `/sessions/[id]`
- Placeholder session view page created at `/sessions/[id]/page.tsx`

## Benefits

- **Platform builders get composable primitives**: hooks respect aggregate boundaries, no hidden orchestration
- **SDK consumers choose their composition**: the same hooks work in any React app, not just the Stigmer Console
- **Consistent session creation**: always session-first, then execution — no conditional branching
- **Future-proof naming**: `useCreateAgentExecution` leaves room for `useCreateWorkflowExecution`
- **Minimal backend coupling**: frontend never specifies agent — backend resolves default automatically

## Impact

- **Users**: Can now start a session from the landing page with a single message
- **Platform consumers**: Get headless-first React hooks and styled components for session/execution creation
- **SDK architecture**: Establishes the three-layer pattern (data/behavior/styled) as the standard for all future `@stigmer/react` modules
- **Backend**: Session creation no longer requires `agent_instance_id` — the default agent flow is fully automated

## Related Work

- [Web UI Teardown](./2026-03-17-100241-web-ui-teardown-session-first-clean-slate.md) — T01.3 that cleared the slate
- [React SDK Teardown](./2026-03-17-102117-react-sdk-teardown-session-first-clean-slate.md) — companion cleanup
- [Three-Panel Layout](./2026-03-17-103523-web-app-shell-three-panel-layout.md) — T01.4 app shell
- [Headerless Layout](./2026-03-17-111118-headerless-sidebar-driven-layout.md) — layout refinement
- [Backend Default Agent Resolution](./2026-03-17-101132-backend-default-agent-resolution.md) — T01.2 execution pipeline

---

**Status**: Production Ready
**Timeline**: T01.5 implementation (session 7)
