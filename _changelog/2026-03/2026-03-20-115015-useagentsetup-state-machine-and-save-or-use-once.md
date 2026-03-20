# useAgentSetup State Machine and Save-or-Use-Once Model

**Date**: March 20, 2026

## Summary

Replaced the fragile ref-based state in `useAgentSetup` with a `useReducer` state machine and introduced a unified "save or use once" model for secret delivery. Platform builders and Console users can now choose whether to persist agent credentials for future runs or use them for a single execution — a distinction that was previously impossible in the SDK.

## Problem Statement

The `useAgentSetup` hook — the Layer 2 orchestration hook that manages agent selection and credential collection in `@stigmer/react` — had four implementation flaws:

### Pain Points

- **Fragile ref-based state**: `pendingRef.current` held agent state between `resolveAgent()` and `submitEnvVars()`. Refs don't trigger re-renders and can hold stale values on rapid agent switching.
- **Duplicated instance creation**: `useAgentSetup` called `stigmer.agentInstance.create(buildPersonalInstanceInput(...))` directly in two places instead of using the shared personal instance creation pattern.
- **Hook did too much**: One hook handled agent fetching, instance listing, env_spec diffing, personal environment orchestration, and personal instance creation — with no separation of concerns.
- **No "use once" path**: All missing env vars were always saved to the personal environment. There was no way for users to say "just use this for this run" — a critical capability for B2B integrations and one-off debugging.

## Solution

A four-part refactoring that introduces a state machine, extracts pure functions, and adds dual-path secret routing:

1. **State machine** (`useReducer`) with five phases: `idle → resolving → needsEnvVars → submitting → ready`
2. **Extracted `diffEnvSpec`** as a pure, independently testable function
3. **Three-mode resolution type** (`AgentResolution`): `saved`, `oneTime`, `direct`
4. **`saveForFuture` flag** on `submitEnvVars` that routes to the correct codepath

## Implementation Details

### New Types

```typescript
// Three explicit modes — self-documenting for platform builders
type AgentResolution =
  | { mode: "saved"; instanceId: string }      // Persisted to personal env + instance
  | { mode: "oneTime"; runtimeEnv: Record<string, EnvVarInput> }  // Ephemeral, per-execution
  | { mode: "direct" };                         // No secrets needed

// State machine with typed payloads per phase
type AgentSetupPhase =
  | { status: "idle" }
  | { status: "resolving"; agentRef: ResourceRef }
  | { status: "needsEnvVars"; agentRef: ResourceRef; agentId: string; agentName: string; missingVariables: AgentEnvFormVariable[] }
  | { status: "submitting"; agentRef: ResourceRef; agentId: string; agentName: string }
  | { status: "ready"; agentRef: ResourceRef; agentName: string; resolution: AgentResolution };
```

### New Files

- **`diffEnvSpec.ts`** — Pure function extracted from `useAgentSetup`. Compares agent `env_spec.data` against existing environment keys. Zero dependencies, independently testable.
- **`agentSetupReducer.ts`** — All state machine types (`AgentResolution`, `AgentSetupState`, `AgentSetupPhase`), actions, reducer function, and initial state.

### Hook Changes

- `useAgentSetup` now returns `{ state, resolveAgent, submitEnvVars, clearError, reset }` instead of `{ resolveAgent, submitEnvVars, isResolving, error, clearError }`
- `submitEnvVars` accepts optional `{ saveForFuture?: boolean }` — `true` (default) persists, `false` returns instant `runtimeEnv`
- The "one-time" path makes zero API calls — collected values are returned as `runtimeEnv` immediately

### Component Changes

- **`AgentEnvForm`** — Added accessible "Save for future runs" toggle with `defaultSaveForFuture` and `hideSaveToggle` props. Button text adapts: "Save" / "Use once". New `onSubmit(values, { saveForFuture })` signature.
- **`SessionComposer`** — Replaced `onAgentInstanceIdChange` with `onAgentResolutionChange`. Removed `pendingEnvRef` and `agentPopoverView` — both now derived from hook state. Popover content switches automatically based on `state.status`.
- **`SessionLauncher`** — Exhaustive `switch (resolution.mode)` routing for all three session/execution creation paths.

### Design Decisions

- **Three modes over two**: `saved`, `oneTime`, `direct` — rather than collapsing `direct` into `oneTime` with optional `runtimeEnv`. Three named modes are self-documenting in TypeScript intellisense and force exhaustive handling.
- **No hook composition**: `usePersonalAgentInstance` can't be composed due to imperative/reactive timing mismatch. `buildPersonalInstanceInput` is the shared surface; the create call is trivial.
- **State machine over XState**: The state graph is simple enough for `useReducer`. Each phase carries typed payload, enabling TypeScript narrowing in consumers.

## Benefits

- **Eliminates stale-ref bugs**: All state is in the reducer — no more `pendingRef.current` that can hold stale values across rapid agent switches
- **Enables one-time secrets**: Users and platform builders can now provide credentials for a single execution without polluting their personal environment
- **Better consumer DX**: `SessionComposer` derives its view entirely from hook state — no manual `agentPopoverView` or `pendingEnvRef` synchronization
- **Testable diffing**: `diffEnvSpec` is a pure function that can be unit-tested without mocking hooks, providers, or API calls
- **Explicit routing**: `AgentResolution` with three modes makes the session creation path self-documenting — consumers switch on `mode` with exhaustive handling

## Impact

- **SDK consumers** (`@stigmer/react`): New `AgentResolution` type, updated `UseAgentSetupReturn`, updated `AgentEnvFormProps` and `SessionComposerProps`. Breaking change to `onSubmit` signature and `onAgentInstanceIdChange` → `onAgentResolutionChange`.
- **Console** (`client-apps/web`): `SessionLauncher` updated to route via resolution mode. Clean compilation.
- **Platform builders**: Can now embed the env var collection flow with the save toggle, or use `hideSaveToggle` to enforce a single policy. The headless hooks (`useAgentSetup`) support both paths without requiring the styled component.

## Related Work

- T01: Fix CLI docs (completed earlier this session series)
- T04: Session API cleanup with mutual-exclusion type (completed earlier)
- T03: Rename `env_refs` → `environment_refs` (completed earlier)
- T05 (next): Follow-up message one-time secrets input
- T06 (next): Error messages across secret flows

---

**Status**: Production Ready
**Timeline**: Single session (~1 hour implementation)
