# Two-Flow Secret Delivery Reframe

**Date**: March 19, 2026

## Summary

Reframed the SDK's secret management architecture from a "two consumer profiles" model (Platform Builders vs Direct Users) to a "two secret delivery flows" model (Environment Flow vs Execution Flow) with orthogonal orchestration levels. Exposed the missing `runtimeEnv` parameter in the React SDK, updated JSDoc across 16 hooks/components, and created comprehensive product documentation for the canonical secret delivery guide.

## Problem Statement

The original design decision (DD-005) framed hook layering around two consumer profiles — Platform Builders who compose building-block hooks, and Direct Users who use orchestration hooks. While the layering model was sound, it conflated *who uses the system* with *how secrets are delivered*, creating ambiguity about which hooks serve which purpose and obscuring a critical gap: the React SDK had no way to inject ephemeral, per-execution secrets (the Execution Flow).

### Pain Points

- The "Profile A / Profile B" framing didn't map to a concrete action a developer could take — it was about identity, not about a technical choice
- `runtimeEnv` was fully supported in proto → TypeScript SDK → Go/Java backend but wasn't exposed in the React SDK's `useCreateAgentExecution` or `useSessionConversation`, leaving Execution Flow users without a React-native path
- JSDoc comments referenced "Profile A" and "Profile B" which required developers to look up the design decision to understand what they meant
- No product documentation existed to help developers choose between persistent (Environment) and ephemeral (Execution) secret delivery

## Solution

Reframed the architecture around two orthogonal dimensions:

1. **Secret Delivery Flow** — *How* secrets reach the agent sandbox:
   - **Environment Flow**: Persistent credentials stored in Environment resources, bound via AgentInstance, resolved automatically at execution time
   - **Execution Flow**: Ephemeral credentials passed via `runtimeEnv` at execution creation, highest merge priority, deleted on completion

2. **Orchestration Level** — *How much* the hook does for you:
   - **Layer 1 (Building-Block)**: Single-responsibility hooks mapping 1:1 to API resources
   - **Layer 2 (Orchestration)**: Multi-step hooks composing Layer 1 for convention-driven flows

These dimensions are independent — any developer can use any combination.

## Implementation Details

### Design Decision Rewrite (DD-005)

Rewrote `design-decisions/005-two-profile-hook-layering.md` from "Two-Profile Hook Layering" to "Two-Flow Secret Delivery and Hook Layering". The new document establishes the orthogonal model with a flow × layer matrix mapping every hook and component.

### React SDK: Execution Flow Surface

Added `runtimeEnv` to two hooks:

- **`useCreateAgentExecution`** — `CreateAgentExecutionInput.runtimeEnv?: Record<string, EnvVarInput>` passes through to the TypeScript SDK client. Includes dual-flow JSDoc with code examples for both Environment and Execution paths.
- **`useSessionConversation`** — `SendFollowUpOptions.runtimeEnv` forwarded to execution creation, enabling conversation-based UIs to inject per-execution secrets.

### JSDoc Alignment (16 files)

Updated every environment, agent-instance, agent, and execution hook/component to replace "Profile A/B" references with explicit "Environment Flow" or "Execution Flow" annotations. Added `@see` cross-references to the new product documentation.

Files updated:
- `sdk/react/src/environment/` — 10 files (useEnvironment, useEnvironmentList, useCreateEnvironment, useUpdateEnvironment, useUpdateEnvironmentVariables, useRemoveEnvironmentVariables, usePersonalEnvironment, useRevealSecretValue, EnvironmentVariableEditor, EnvironmentListPanel, CreateEnvironmentForm)
- `sdk/react/src/agent-instance/` — 4 files (useAgentInstance, useAgentInstanceList, useCreateAgentInstance, usePersonalAgentInstance)
- `sdk/react/src/agent/` — 1 file (useAgentSetup)
- `sdk/react/src/execution/` — 1 file (useCreateAgentExecution)

### Product Documentation

Created `docs/product/how-to-provide-secrets.md` (264 lines) — the canonical guide for secret delivery, including:
- Environment Flow and Execution Flow explanations with when-to-use guidance
- React SDK, TypeScript SDK, and CLI code examples for both flows
- Decision table comparing persistence, merge priority, and use cases
- Merge priority documentation (runtime_env > environment layer > agent defaults)
- Hook and component reference table organized by flow and layer

Added "Further Reading" cross-references in 4 existing product docs: `what-is-environment.md`, `what-is-execution-context.md`, `what-is-agent-execution.md`, `what-is-agent-instance.md`.

## Benefits

- **Clearer mental model**: Developers choose a flow based on their technical need (persistent vs ephemeral), not based on who they think they are
- **Complete Execution Flow in React**: Platform builders can now pass `runtimeEnv` from React without dropping to the TypeScript SDK
- **Self-documenting hooks**: Every hook's JSDoc tells you which flow it serves and links to the product guide
- **Canonical product documentation**: One place to understand secret delivery instead of piecing it together from proto comments, SDK types, and design decisions

## Impact

- **React SDK consumers**: Can now use both secret delivery flows entirely from `@stigmer/react`
- **Platform builders**: `runtimeEnv` on `useCreateAgentExecution` and `useSessionConversation.sendFollowUp` enables B2B integrations where per-call credentials are injected at runtime
- **Documentation**: 16 hooks/components have improved JSDoc, 1 new product guide, 4 existing docs cross-referenced
- **Architecture**: DD-005 now serves as the canonical reference for how hooks are organized across flows and layers

## Related Work

- Session 12: `usePersonalEnvironment` and `usePersonalAgentInstance` orchestration hooks (Layer 2 Environment Flow)
- Session 13: `AgentEnvForm` and `useAgentSetup` (Layer 2 Environment Flow UI)
- Session 16: `EnvironmentVariableEditor`, `EnvironmentListPanel`, `CreateEnvironmentForm` (Environment Flow management components)
- `_changelog/2026-03/2026-03-19-180749-personal-env-instance-orchestration-hooks.md`
- `_changelog/2026-03/2026-03-19-182911-agent-env-form-and-session-composer-integration.md`
- `_changelog/2026-03/2026-03-19-192354-settings-page-environment-management.md`

---

**Status**: Production Ready
**Timeline**: ~2 hours (analysis, implementation, documentation)
