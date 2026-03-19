# Personal Environment & Agent Instance Orchestration Hooks

**Date**: March 19, 2026

## Summary

Upgraded the read-only `usePersonalEnvironment` and `usePersonalAgentInstance` React hooks into full Layer 2 orchestration hooks with `getOrCreate`, `addVariables`, and `removeVariables` capabilities. These hooks encapsulate the entire personal resource lifecycle — deterministic naming, label conventions, and multi-step provisioning — behind a clean API that direct Stigmer users consume without ever seeing the underlying resource model.

## Problem Statement

Phase 1 of the agent-picker-personal-env project delivered Layer 1 building-block hooks and the AgentPicker component. Phase 2 requires orchestration hooks that abstract the multi-step "personal environment" provisioning flow: check if a personal environment exists, create it if not, add credentials, create a personal agent instance linked to that environment.

### Pain Points

- The existing `usePersonalEnvironment` and `usePersonalAgentInstance` hooks (from sub-project .04) were read-only convenience wrappers — they could query personal resources but not create or mutate them.
- The Phase 2 UI components (`AgentEnvForm`, `SessionComposer` agent flow) need orchestration hooks that handle the get-or-create lifecycle and variable management.
- Platform builders need the Layer 1 hooks; direct Stigmer users need Layer 2 hooks that compose them. Both must be exported from `@stigmer/react`.

## Solution

Extended both existing hooks in place (backward-compatible return type expansion) rather than creating separate "manager" hooks. The hooks compose Layer 1 data hooks for declarative reading and use the SDK client directly for mutations with unified state management.

## Implementation Details

### `usePersonalEnvironment(org)` — Extended Return Type

- `getOrCreate(initialData?)` — Creates a personal environment with slug `"personal"` and label `stigmer.ai/personal: "true"` if one doesn't exist. Optional `initialData` seeds variables on creation, saving a round-trip for first-time users.
- `addVariables(variables)` — Server-side merge via `updateVariables` RPC. Converts friendly `EnvVarInput` to proto internally.
- `removeVariables(keys)` — Server-side removal via `removeVariables` RPC.
- `isMutating` — Unified boolean for any in-progress mutation.
- Uses `useRef` for stable environment reference so mutation callbacks aren't recreated on every list response.

### `usePersonalAgentInstance(org, agentId?)` — Extended Return Type

- `getOrCreate({ agentSlug, personalEnvironmentRef })` — Creates a personal instance with slug `"{agentSlug}-personal"`, labels `stigmer.ai/personal` + `stigmer.ai/for-agent`, agent binding, and environment linkage.
- `isMutating` — Boolean for in-progress creation.
- New exported type: `GetOrCreatePersonalInstanceInput`.
- `agentId` is optional for read-only use but required for `getOrCreate` (descriptive error if missing).

### Design Decisions

1. **Extend in place, not new hooks** — Adding fields to the return type is backward compatible. Two "personal environment" exports would violate clean SDK discoverability.
2. **SDK client for mutations, Layer 1 hooks for reading** — Composing multiple React mutation hooks creates confusing multi-state. The orchestration hook needs unified `isMutating` / `error`.
3. **List+labels for existence check** — Empty list = "doesn't exist" (clean signal). `getByReference` throws on 404, requiring ambiguous error handling.
4. **`getOrCreate` with optional initial data** — Saves a round-trip vs. creating empty then calling `addVariables`.
5. **Naming conventions fully encapsulated** — Callers never construct `"personal"`, `"{slug}-personal"`, or label strings.

## Benefits

- Direct Stigmer users get a seamless personal environment flow without understanding the underlying resource model (Environment, AgentInstance, labels, slugs).
- Platform builders continue using Layer 1 hooks unchanged — backward compatible.
- The `AgentEnvForm` and `SessionComposer` integration (T02.3, T02.4) now have the orchestration API they need.
- Error messages are actionable: "Call getOrCreate() before addVariables()" instead of cryptic null dereferences.

## Impact

- **SDK consumers**: `@stigmer/react` exports 4 modified files, 1 new type (`GetOrCreatePersonalInstanceInput`). All existing imports and destructuring patterns continue to work.
- **Phase 2 readiness**: T02.1 and T02.2 are complete. T02.3 (`AgentEnvForm`) and T02.4 (`SessionComposer` integration) can now proceed.

## Related Work

- Sub-project .04: Added the read-only list hooks and personal convenience wrappers
- Sub-project .05: Added labels to SDK codegen, `updateVariables`/`removeVariables` RPCs, and sentinel defense — all prerequisites consumed by these hooks
- Phase 1 (T01.1–T01.11): Layer 1 hooks + AgentPicker + SessionComposer agent props

---

**Status**: Production Ready
**Timeline**: Single session (~30 minutes)
