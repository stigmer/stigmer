# MCP Server Setup Reducer — Per-Server State Machine

**Date**: March 20, 2026

## Summary

Added `mcpServerSetupReducer` — a pure, independently testable state machine that manages per-server setup state for MCP servers in the SessionComposer selection flow. This is the foundation for Phase 1 of the MCP server setup feature, which brings proactive credential collection and per-tool selection to MCP server configuration.

## Problem Statement

When users select MCP servers in the SessionComposer, the system has no proactive setup flow. Missing credentials are only discovered at execution time via `FAILED_PRECONDITION` errors. The agent flow already has a state machine (`agentSetupReducer`) that drives proactive env var collection, but no equivalent exists for MCP servers — which are multi-select and require per-server independent tracking.

### Pain Points

- No proactive credential collection for MCP servers at selection time
- No state machine to track multiple servers through setup simultaneously
- No foundation for the orchestration hook (`useMcpServerSetup`) to compose

## Solution

Created a pure reducer that manages a `Record<string, McpServerSetupEntry>` keyed by `"org/slug"`, where each entry independently tracks one MCP server through `loading -> needsSetup -> submitting -> ready`. Follows the `agentSetupReducer` pattern with error orthogonal to phase, but extends it to handle N concurrent entries.

## Implementation Details

**New file**: `sdk/react/src/mcp-server/mcpServerSetupReducer.ts`

**State model** — 4 statuses per entry:
- `loading` — fetching the full McpServer resource
- `needsSetup` — env_spec has missing variables, credential form needed
- `submitting` — credentials being persisted or collected
- `ready` — fully configured, carries `enabledTools` list

**10 actions**: `ADD_SERVER`, `RESOLVE_NEEDS_SETUP`, `RESOLVE_READY`, `SUBMIT_START`, `SUBMIT_DONE`, `SET_ENABLED_TOOLS`, `SET_ERROR`, `CLEAR_ERROR`, `REMOVE_SERVER`, `RESET`

**Design refinements from master plan**:
- Merged `ready` + `ready-default` into single `ready` (fewer variants, simpler consumers)
- Removed `configuring` status (UI navigation state belongs in component, not reducer)
- Added `submitting` status (needed for `EnvVarForm` loading indicator)
- Error orthogonal to phase (preserves form context on failure, matches agent pattern)

**Exports**: `McpServerSetupPhase`, `McpServerSetupEntry`, `McpServerSetupState`, `McpServerSetupAction`, `INITIAL_MCP_SETUP_STATE`, `mcpServerSetupReducer`, `toServerKey`

## Benefits

- **Pure function** — independently testable without React, hooks, or API mocking
- **Pattern consistency** — mirrors `agentSetupReducer` conventions (readonly fields, orthogonal error, guard transitions)
- **Multi-entry** — tracks N servers simultaneously via Record-based state
- **Foundation** — enables T01.2 (`useMcpServerSetup` hook) to compose via `useReducer`

## Impact

- `@stigmer/react` gains the state management foundation for MCP server setup
- Unblocks Phase 1 T01.2 (orchestration hook), Phase 2 (UI components), and Phase 3 (SessionComposer integration)
- No breaking changes — new file only, no modifications to existing code

## Related Work

- `agentSetupReducer.ts` — the agent-side pattern this mirrors
- Phase 0 (EnvVarForm extraction) — completed in session 1, provides shared credential form
- T01.2 (`useMcpServerSetup`) — next task, will compose this reducer

---

**Status**: In Progress (Phase 1 T01.1 complete, T01.2 next)
**Timeline**: ~1 session
