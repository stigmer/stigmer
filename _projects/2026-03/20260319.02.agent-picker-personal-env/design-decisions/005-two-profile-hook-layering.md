# Design Decision 005: Two-Flow Secret Delivery and Hook Layering

**Date**: 2026-03-19
**Updated**: 2026-03-19 (reframed from "Two-Profile Hook Layering")
**Status**: Accepted

## Context

Stigmer supports two fundamentally different ways to deliver secrets to agents at runtime. These are not tied to a specific consumer persona — any user (platform builder or direct user) can choose either flow based on their operational needs. The SDK must support both flows with appropriate hooks, components, and documentation.

Additionally, hooks are organized in two orchestration layers to serve different levels of control. The two dimensions — **secret delivery flow** and **orchestration level** — are orthogonal.

## Dimension 1: Secret Delivery Flow

### Environment Flow (persistent credentials)

Secrets are stored in **Environment** resources, bound to agents via **AgentInstance** references. Secrets persist across executions — set up once, available for every future run.

When to use:
- Credentials that are reused across many executions (API tokens, OAuth secrets)
- Team-shared credentials that multiple agents reference
- Users who manage their own credentials through a settings UI
- Credential rotation without changing agent configuration

### Execution Flow (ephemeral credentials)

Secrets are passed via `runtime_env` at execution creation time. They exist for a single execution and are deleted when the execution completes.

When to use:
- B2B SaaS integrations where each API call injects the caller's customer's credentials
- One-off secrets that should not persist (temporary access tokens, session-scoped keys)
- Programmatic orchestration where the calling system holds the secrets
- Per-execution overrides that take priority over persistent environment values

### Merge Priority

Both flows can be active simultaneously. The backend merges all sources with clear priority (lowest to highest):

1. `Agent.env_spec.data` — template defaults
2. `AgentInstance.environment_refs` — resolved Environment resources (Environment Flow)
3. `AgentExecution.runtime_env` — execution-scoped overrides (Execution Flow)

## Dimension 2: Orchestration Level

### Layer 1: Building-Block Hooks

Each hook wraps exactly one SDK client method. No orchestration, no conventions, no magic. Used by anyone who wants fine-grained control.

| Hook | Flow | Does |
|------|------|------|
| `useAgentSearch(org)` | Both | Search agents |
| `useEnvironment(ref)` | Environment | Fetch one environment |
| `useEnvironmentList(org)` | Environment | List environments with label filtering |
| `useCreateEnvironment()` | Environment | Create any environment |
| `useUpdateEnvironment()` | Environment | Update any environment |
| `useUpdateEnvironmentVariables()` | Environment | Incremental variable merge |
| `useRemoveEnvironmentVariables()` | Environment | Remove variables by key |
| `useRevealSecretValue()` | Environment | Reveal a single secret value |
| `useAgentInstance(ref)` | Environment | Fetch one agent instance |
| `useAgentInstanceList(org)` | Environment | List agent instances with label filtering |
| `useCreateAgentInstance()` | Environment | Create any agent instance |
| `useCreateSession()` | Both | Create session (accepts `agentInstanceId` or `agentRef`) |
| `useCreateAgentExecution()` | Both | Create execution (accepts `runtimeEnv` for Execution Flow) |

### Layer 2: Orchestration Hooks

Each hook composes Layer 1 hooks to implement multi-step managed flows. Encapsulates naming conventions, labels, and provisioning logic.

| Hook | Flow | Composes | Does |
|------|------|----------|------|
| `usePersonalEnvironment(org)` | Environment | `useEnvironmentList` + SDK client | Get/create personal env, add/remove variables |
| `usePersonalAgentInstance(org, agentId)` | Environment | `useAgentInstanceList` + SDK client | Get/create personal agent instance |
| `useAgentSetup(org)` | Environment | `usePersonalEnvironment` + SDK client | Full agent selection + env var collection flow |

### Components

| Component | Layer | Flow | Purpose |
|-----------|-------|------|---------|
| `AgentPicker` | 1 | Both | Pure selection UI, no provisioning logic |
| `AgentEnvForm` | 1 | Both | Pure form that collects env vars from `env_spec` |
| `EnvironmentVariableEditor` | 1 | Environment | Self-contained variable CRUD for any environment |
| `EnvironmentListPanel` | 1 | Environment | Accordion list of environments with inline editors |
| `CreateEnvironmentForm` | 1 | Environment | Form for creating new environments |
| `SessionComposer` (with agent props) | 2 | Environment | Full agent picker + env form + session creation |

## The Corrected Matrix

Any user can use any combination of flow and layer:

| Scenario | Flow | Layer | Hooks/Components Used |
|----------|------|-------|----------------------|
| Platform builder pre-provisions credentials via API | Environment | 1 | `useCreateEnvironment`, `useCreateAgentInstance`, `useCreateSession` |
| Platform builder injects per-customer secrets at call time | Execution | 1 | `useCreateAgentExecution` with `runtimeEnv` |
| Direct user picks agent, provides credentials in UI | Environment | 2 | `SessionComposer`, `useAgentSetup`, `AgentEnvForm` |
| Direct user manages credentials in settings | Environment | 1+2 | `EnvironmentVariableEditor`, `usePersonalEnvironment` |
| Automated pipeline passes one-off secrets | Execution | 1 | `useCreateAgentExecution` with `runtimeEnv` |

## Rationale

1. **Two flows, not two profiles.** The original framing mapped Environment Flow to "direct users" and Execution Flow to "platform builders." This was incomplete — a platform builder might use the Environment Flow for shared team credentials, and a direct user might use the Execution Flow for one-off secrets. The flow choice depends on the operational need, not the user type.

2. **Layer 1 hooks should not assume a flow.** `useCreateAgentExecution` must accept `runtimeEnv` alongside the existing session/agent parameters. A platform builder who wants to inject per-call secrets should be able to do so through the same hook that creates executions — without being forced into the Environment provisioning path.

3. **Layer 2 orchestration is Environment-Flow-specific.** The personal environment pattern (`usePersonalEnvironment`, `useAgentSetup`) is an opinionated convenience for the Environment Flow. There is no equivalent Layer 2 for the Execution Flow because passing `runtimeEnv` at call time does not require multi-step orchestration.

4. **Layer 2 composes Layer 1.** The orchestration hooks use the same building-block hooks that direct Layer 1 consumers use. This ensures the building blocks are complete and well-tested.

## Documentation Requirement

Every exported hook and component must include JSDoc that states:
- Which **flow** it supports (Environment Flow, Execution Flow, or both)
- Whether it is Layer 1 (building block) or Layer 2 (orchestration)
- A usage example for each applicable flow
- Cross-references to alternative hooks for the other flow or layer

## Consequences

- Both secret delivery flows are first-class citizens in the React SDK
- Platform builders using `runtimeEnv` get the same hook quality as Environment Flow users
- The same building blocks power both flows, ensuring completeness
- Every hook is exported — no internal-only hooks that consumers cannot access
- Layer 2 hooks are explicitly scoped to the Environment Flow; this is documented, not hidden
