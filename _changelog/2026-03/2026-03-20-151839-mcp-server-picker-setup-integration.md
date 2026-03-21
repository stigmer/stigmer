# McpServerPicker Setup Integration — Two-Mode Picker with Drill-In Configuration

**Date**: March 20, 2026

## Summary

Enhanced the `McpServerPicker` component to support a setup-integrated mode alongside its existing simple mode. When platform builders pass the new `setup` prop, the picker gains per-server status indicators (loading, needs credentials, ready, error), inline retry for failures, and drill-in navigation to `McpServerConfigPanel` for credential collection and per-tool selection — all within the same popover container.

## Problem Statement

The `McpServerPicker` was a simple toggle-on/toggle-off multi-select with no awareness of server setup state. MCP servers that require credentials (`env_spec`) were added as black boxes — users only discovered missing credentials at execution time via `FAILED_PRECONDITION` errors. There was no visibility into which tools a server provides, no way to customize tool selection, and no inline path to provide credentials.

### Pain Points

- No proactive credential collection at selection time — reactive error discovery only
- No per-tool selection — all tools enabled as a black box
- No setup status visibility — loading, error, and needs-setup states invisible to the user
- Picker had no drill-in capability — configuration required leaving the popover context

## Solution

Extended `McpServerPicker` with a second operating mode activated by a `setup?: McpServerSetupIntegration` prop. The grouped sub-object contains `entries` (per-server setup state from `useMcpServerSetup`) and all required callbacks (`onServerAdded`, `onServerRemoved`, `onSubmitEnvVars`, `onEnabledToolsChange`). When `setup` is provided, the picker renders status indicators per server and supports drill-in to `McpServerConfigPanel`.

## Implementation Details

### New type: `McpServerSetupIntegration`

Grouped sub-object exported from `McpServerPicker.tsx`. All callbacks are required when setup is enabled — TypeScript prevents invalid partial states at compile time. Matches the `credentials?` sub-object pattern from `McpServerConfigPanel`.

### Two-mode props design

`value` and `onChange` become optional (not a breaking change — existing callers pass both). In setup mode, selection is managed through `setup.entries` + setup callbacks. Platform builders don't need to pass `onChange={() => {}}`.

### Internal view state

`useState<PickerView>` manages list vs. configure views. The picker owns drill-in navigation internally — platform builders get it for free. A `useEffect` guard resets the view when the configured entry disappears (handles chip removal, external state changes).

### Per-row status indicators

- **Loading** — spinner + "Loading..." label
- **Loading + error** — red dot, truncated error message, retry button
- **Needs setup** — amber dot + "Configure" button
- **Submitting** — spinner + "Saving..." label
- **Ready** — green dot + tool count (e.g., "3/12 tools") + chevron for drill-in

### Config panel drill-in

When the user clicks "Configure" or the tool count chevron, the picker replaces its list view with `McpServerConfigPanel`. Entry state is mapped to panel props: `credentials` sub-object built for `needsSetup`/`submitting` entries, all discovered tool names used as preview `enabledTools` during setup, `entry.enabledTools` used for ready entries.

### SSR safety

Replaced hardcoded `const LIST_ID = "stgm-mcp-list"` with `useId()` — safe for multiple picker instances on the same page.

### Internal component extraction

`SetupServerRow` and `SimpleServerRow` extracted as file-internal components. `StatusIndicator` renders the appropriate dot/spinner per status.

## Benefits

- **Error prevention** — credentials collected at selection time, not at execution time (Nielsen's heuristic #5)
- **Progressive disclosure** — tool selector disabled while credentials are pending, becomes interactive after submission
- **Platform builder DX** — one `setup` prop activates the entire flow; grouped interface prevents misconfiguration
- **Backward compatible** — omit `setup` and the picker works identically to before
- **Multi-instance safe** — `useId()` enables multiple pickers on the same page

## Impact

- **Platform builders** gain a drop-in setup flow for MCP servers — pass `useMcpServerSetup()` output to the picker and get credential collection + tool selection for free
- **End users** see setup state at a glance and can configure servers without leaving the popover
- **Phase 3** (SessionComposer wiring) can now consume the enhanced picker with full setup integration

## Related Work

- Phase 0: EnvVarForm extraction from AgentEnvForm
- Phase 1: `mcpServerSetupReducer` + `useMcpServerSetup` hook
- Phase 2, T02.1: `McpToolSelector` component
- Phase 2, T02.2: `McpServerConfigPanel` component
- Next: Phase 3 — SessionComposer integration, submission blocking, enhanced chips

---

**Status**: Production Ready
**Timeline**: Session 6 of the MCP Server Setup Flow project
