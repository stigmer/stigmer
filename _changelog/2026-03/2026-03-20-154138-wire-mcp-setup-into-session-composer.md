# Wire MCP Server Setup Flow into SessionComposer

**Date**: March 20, 2026

## Summary

Wired `useMcpServerSetup` into `SessionComposer`, connecting the proactive credential collection and per-tool selection flow that was built across Phases 0–2. MCP servers selected in the composer now go through the full setup lifecycle — fetch, env_spec check, credential collection, tool selection — instead of being added as opaque references with no validation.

## Problem Statement

The SessionComposer's MCP server integration was passive — users could select MCP servers via the picker, but no proactive validation occurred. Missing credentials were only discovered at execution time via `FAILED_PRECONDITION` errors, and there was no visibility into which tools each server provides or which require HITL approval.

### Pain Points

- Missing credentials surfaced as runtime errors, not at selection time
- No tool selection or visibility — MCP servers were black boxes
- No credential collection inline — users had to configure secrets separately
- The setup infrastructure (reducer, hook, UI components) was built but not connected to the composer

## Solution

Connected the `useMcpServerSetup` orchestration hook to `SessionComposer`, making the MCP popover a controlled, setup-aware integration point. The picker now operates in setup mode with per-server status tracking, credential collection, and tool selection — all inline within the popover.

## Implementation Details

**Single file changed**: `sdk/react/src/composer/SessionComposer.tsx` (+77/-34 lines)

**Hook instantiation**: `useMcpServerSetup` called alongside `useAgentSetup`, disabled when MCP is not shown.

**Popover control**: MCP popover made controlled (`open`/`onOpenChange`). Unlike agent popover (resets on close), MCP entries persist — multi-select state survives popover close/reopen cycles.

**Setup prop wiring**: `McpServerPicker` receives the `setup` prop connecting all hook callbacks — `onServerAdded`, `onServerRemoved`, `onSubmitEnvVars`, `onEnabledToolsChange` — enabling the full drill-in configuration flow.

**Derived state sync**: `useEffect` pushes `usageInputs` to consumer via `onMcpServerUsagesChange`. This reactive approach (vs. agent's imperative push) handles multi-entry derived state where any entry can transition to/from `ready` asynchronously.

**Chip generation**: MCP chips now derive from hook entries (all selected servers, including loading/needsSetup) instead of the `mcpServerUsages` prop (which only contained ready servers).

Three design decisions made:
- **DD-T03.1**: Always-on setup mode — no opt-in prop needed
- **DD-T03.2**: Popover close preserves entries — respects multi-select commitment
- **DD-T03.3**: `useEffect` sync for derived state — correct pattern for multi-entry async flows

## Benefits

- Proactive credential collection at MCP server selection time (vs. runtime error)
- Per-tool selection with approval policy visibility inline in the composer
- Consistent UX between agent setup (already proactive) and MCP server setup
- No breaking API changes — `SessionComposerProps` unchanged
- Platform builders get the setup flow for free when using `SessionComposer`

## Impact

- **SDK consumers**: No prop changes. `mcpServerUsages` prop becomes output-only (updated via callback). Consumers who read it for session creation continue to work.
- **End users**: MCP server selection now triggers credential validation and tool discovery inline, preventing runtime failures.
- **Architecture**: Completes the data flow chain: `mcpServerSetupReducer` → `useMcpServerSetup` → `McpServerPicker` (setup mode) → `SessionComposer`.

## Related Work

- [MCP Server Setup Reducer](2026-03-20-135611-mcp-server-setup-reducer.md) — Phase 1, T01.1
- [MCP Server Setup Orchestration Hook](2026-03-20-141555-mcp-server-setup-orchestration-hook.md) — Phase 1, T01.2
- [MCP Tool Selector Component](2026-03-20-143246-mcp-tool-selector-component.md) — Phase 2, T02.1
- [MCP Server Config Panel](2026-03-20-145719-mcp-server-config-panel.md) — Phase 2, T02.2
- [MCP Server Picker Setup Integration](2026-03-20-151839-mcp-server-picker-setup-integration.md) — Phase 2, T02.3
- [Extract EnvVarForm Shared Component](2026-03-20-132711-extract-envvarform-shared-component.md) — Phase 0

---

**Status**: ✅ Production Ready
**Timeline**: Phase 3, T03.1 of the MCP Server Setup Flow project
