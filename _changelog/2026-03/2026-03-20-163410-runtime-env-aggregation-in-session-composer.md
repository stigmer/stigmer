# RuntimeEnv Aggregation in SessionComposer

**Date**: March 20, 2026

## Summary

SessionComposer now aggregates one-time environment variables from all three credential sources (agent setup, MCP server setup, manual secrets) into a single `runtimeEnv` object provided to `onSubmit` at submission time. This completes the MCP Server Setup Flow project — the full proactive credential collection, tool selection, and runtime environment delivery pipeline is now wired end-to-end.

## Problem Statement

When a user submits a message through SessionComposer, one-time environment variables can come from three independent sources that the consumer (SessionLauncher, SessionPage) needs to merge into the execution's `runtimeEnv`.

### Pain Points

- MCP server one-time secrets (`pendingRuntimeEnv`) were trapped inside `useMcpServerSetup` which lives inside SessionComposer — the consumer had no way to access them
- Agent one-time secrets flowed via `onAgentResolutionChange`, manual secrets via `useOneTimeSecrets` — each through a different mechanism
- The consumer had to understand three separate runtimeEnv sources and merge them manually with the correct precedence order
- SessionLauncher had a three-branch `switch` on `resolution.mode` with different runtimeEnv handling per branch

## Solution

Introduced `SessionComposerSubmitContext` — a context object passed as an optional third parameter to `onSubmit` that carries the aggregated `runtimeEnv` from all setup flows. SessionComposer reads all three sources at submit time and merges them with explicit precedence ordering.

## Implementation Details

**New type** — `SessionComposerSubmitContext`:
```typescript
interface SessionComposerSubmitContext {
  readonly runtimeEnv?: Record<string, EnvVarInput>;
}
```

**Updated signature** — `SessionComposerProps.onSubmit`:
```typescript
onSubmit: (message: string, modelName?: string, context?: SessionComposerSubmitContext) => void;
```

**Aggregation in `handleSubmit`** — reads from three sources in precedence order (last-write-wins for shared keys like `GITHUB_TOKEN`):
1. Agent one-time secrets (from `agentSetup.state.resolution.runtimeEnv`)
2. MCP one-time secrets (from `mcpSetup.pendingRuntimeEnv` ref)
3. Manual one-time secrets (from `secrets.toRuntimeEnv()`)

Manual secrets win because the user explicitly typed them.

**Hook restructuring** — `useAgentSetup` and `useMcpServerSetup` moved above `handleSubmit` in the component body so the callback can read their state. Hook call order remains consistent across renders.

**Consumer simplification** — SessionLauncher's three-branch `switch` collapsed to a two-branch `if` (`"saved"` vs everything else), with `runtimeEnv: context?.runtimeEnv` applied uniformly. SessionPage removed its manual `secrets.toRuntimeEnv()` call.

## Benefits

- **Zero merge logic for consumers** — platform builders get one merged `runtimeEnv` at submit time without understanding the three internal sources
- **Non-breaking change** — existing `(message, model) => void` handlers ignore the third parameter
- **Simpler consumer code** — SessionLauncher went from 57 lines to 55 lines while gaining MCP runtimeEnv support
- **No reactivity changes** — `pendingRuntimeEnv` stays as `useRef`, read imperatively at submit time

## Impact

- **Platform builders**: Can now pass `context?.runtimeEnv` directly to execution creation. MCP server one-time secrets are transparently included without any additional wiring.
- **Console**: SessionLauncher and SessionPage updated to use the new context parameter. Both are simpler than before.
- **SDK surface**: New exported type `SessionComposerSubmitContext` added to `@stigmer/react` barrel exports.

## Related Work

- Part of **20260320.02.mcp-server-setup-flow** project (Phase 3, T03.4 + T03.5)
- Builds on: `useMcpServerSetup` (Session 3), `McpServerConfigPanel` (Session 5), `McpServerPicker` setup integration (Session 6), SessionComposer wiring (Session 7), submission blocking (Session 8), enhanced chips (Session 9)
- Completes the full MCP server setup pipeline: blueprint → env_spec check → credential collection → tool selection → runtimeEnv delivery

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (Session 10 of 10)
