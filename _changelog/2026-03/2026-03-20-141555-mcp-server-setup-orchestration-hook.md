# MCP Server Setup Orchestration Hook

**Date**: March 20, 2026

## Summary

Added `useMcpServerSetup` — a Layer 2 orchestration hook in `@stigmer/react` that manages the multi-server MCP setup lifecycle. This hook composes the per-server state machine (`mcpServerSetupReducer`), the personal environment, env spec diffing, and the MCP server client to provide proactive credential collection and per-tool selection for MCP servers in the SessionComposer.

## Problem Statement

MCP servers in the SessionComposer are added as black boxes. Missing credentials are only discovered at execution time via `FAILED_PRECONDITION` errors, and there is no UI for selecting which tools to enable. The reducer (state machine) was already built, but there was no orchestration layer to drive it — no hook to fetch server specs, diff env vars, handle save vs one-time credential paths, or derive session creation inputs.

### Pain Points

- No proactive credential check when selecting an MCP server
- No connection between the reducer state machine and the personal environment system
- No derived `McpServerUsageInput[]` for session creation
- No support for one-time (ephemeral) credentials alongside saved credentials

## Solution

Built `useMcpServerSetup(org)` — a hook that mirrors `useAgentSetup` in architecture but is adapted for multi-server orchestration with no instance concept. The hook composes `useReducer`, `usePersonalEnvironment`, `diffEnvSpec`, and `useStigmer().mcpServer` to provide a complete setup flow: add server → resolve credentials → submit env vars → select tools → derive usage inputs.

## Implementation Details

**New file**: `sdk/react/src/mcp-server/useMcpServerSetup.ts` (~310 lines)

**Hook composition**:
- `useReducer(mcpServerSetupReducer)` — per-server state machine
- `usePersonalEnvironment(org)` — credential persistence
- `useStigmer().mcpServer` — server resource fetching
- `useRef<Record<string, EnvVarInput>>` — one-time runtime env accumulation

**Public API**:
- `addServer(ref)` — fetch server, diff env_spec, resolve to ready or needsSetup
- `removeServer(ref)` — remove entry from state
- `submitEnvVars(ref, values, options?)` — save or one-time credential delivery
- `setEnabledTools(ref, tools)` — update tool selection for ready server
- `clearError(ref)` — per-server error clearing
- `reset()` — clear all state
- `allReady`, `needsSetupCount` — submission blocking signals
- `usageInputs` — derived `McpServerUsageInput[]` for session creation
- `pendingRuntimeEnv` — accumulated one-time env vars

**Five design refinements** (DD-R5 through DD-R9) from the master plan:
- `Record` over `Map` for entries (matches reducer)
- `useMemo`-derived `usageInputs` over function
- Flat `useRef` for pending runtime env
- Swallow errors + dispatch (no re-throw) for multi-server
- Per-server `clearError(ref)` instead of global

**Barrel exports** updated in `mcp-server/index.ts` and `index.ts` to expose the hook, return type, options type, and re-exported reducer types at the `@stigmer/react` top level.

## Benefits

- Proactive credential resolution at MCP server selection time (Error Prevention — Nielsen's heuristic #5)
- Unified save-vs-one-time credential model matching the agent flow
- Clean derived `usageInputs` ready for session creation — no manual wiring needed
- Per-server independent error handling for multi-select orchestration
- SDK-first: exported from `@stigmer/react` for platform builder consumption

## Impact

- **Phase 1 complete**: Both the reducer (T01.1) and orchestration hook (T01.2) are done
- **Phase 2 unblocked**: UI components (`McpToolSelector`, `McpServerConfigPanel`, enhanced `McpServerPicker`) can now consume the hook
- **Platform builders**: Can use `useMcpServerSetup` independently to build custom MCP server configuration UIs

## Related Work

- [MCP Server Setup Reducer](2026-03-20-135611-mcp-server-setup-reducer.md) — Phase 1, T01.1
- [Extract EnvVarForm Shared Component](2026-03-20-132711-extract-envvarform-shared-component.md) — Phase 0
- [useAgentSetup State Machine and Save-or-Use-Once](2026-03-20-115015-useagentsetup-state-machine-and-save-or-use-once.md) — Pattern this mirrors

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (planning + implementation)
