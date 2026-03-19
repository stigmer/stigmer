# Design Decision 005: Two-Profile Hook Layering

**Date**: 2026-03-19
**Status**: Accepted

## Context

Stigmer is a platform for platforms. Every SDK hook must answer: "Would a platform builder embedding Stigmer into their product need this?" Two distinct consumer profiles exist:

- **Profile A (Platform Builders)**: Pre-provision agents, environments, and instances via API. Their end users never see env var prompts. Need clean building-block hooks.
- **Profile B (Direct Stigmer Users)**: Pick agents from a searchable list, get prompted for credentials on first use, expect it to "just work" next time. Need high-level orchestration hooks.

## Decision

The SDK exports hooks in two layers:

### Layer 1: Building-Block Hooks (for Platform Builders)

Each hook wraps exactly one SDK client method. No orchestration, no conventions, no magic.

| Hook | Does |
|------|------|
| `useAgentSearch(org)` | Search agents |
| `useEnvironment(ref)` | Fetch one environment |
| `useCreateEnvironment()` | Create any environment |
| `useUpdateEnvironment()` | Update any environment |
| `useAgentInstance(ref)` | Fetch one agent instance |
| `useCreateAgentInstance()` | Create any agent instance |
| `useCreateSession()` | Create session with explicit `agentInstanceId` |

### Layer 2: Orchestration Hooks (for Direct Users)

Each hook composes Layer 1 hooks to implement the personal-environment flow. Encapsulates naming conventions, labels, and multi-step provisioning.

| Hook | Composes | Does |
|------|----------|------|
| `usePersonalEnvironment(org)` | `useEnvironment` + `useCreateEnvironment` + `useUpdateEnvironment` | Get/create personal env, add variables |
| `usePersonalAgentInstance(org, agentRef)` | `useAgentInstance` + `useCreateAgentInstance` | Get/create personal instance |

### Components

| Component | Layer | Profile |
|-----------|-------|---------|
| `AgentPicker` | 1 | Both — pure selection UI, no provisioning logic |
| `AgentEnvForm` | 2 | B — renders from env_spec, but exported for anyone |
| `SessionComposer` (with agent props) | 2 | B — full orchestration experience |

## Rationale

1. **Platform builders should not pay for abstractions they don't need.** A platform builder who pre-provisions everything via API should be able to `useCreateSession({ agentInstanceId: "their-id" })` without the SDK trying to create personal environments.

2. **Direct users should not write orchestration code.** The Console (and any app that wants the full experience) should be able to drop in `SessionComposer` and get agent selection + env var collection for free.

3. **Layer 2 composes Layer 1.** The orchestration hooks are not special — they use the same building-block hooks that platform builders use. This ensures the building blocks are complete and well-tested.

## Documentation Requirement

Every exported hook must include JSDoc that states:
- Which consumer profile it serves (or both)
- Whether it is Layer 1 (building block) or Layer 2 (orchestration)
- A usage example for each applicable profile
- Cross-references to the alternative hook for the other profile

## Consequences

- Platform builders get clean, predictable hooks with no hidden behavior
- Direct users get a seamless experience with automatic provisioning
- The same building blocks power both flows, ensuring completeness
- Every hook is exported — no internal-only hooks that platform builders can't access
