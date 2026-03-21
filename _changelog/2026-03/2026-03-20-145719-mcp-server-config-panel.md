# McpServerConfigPanel Component + Reducer Error Recovery Fix

**Date**: March 20, 2026

## Summary

Added `McpServerConfigPanel` — the per-server drill-in configuration panel that composes `EnvVarForm` (credentials) and `McpToolSelector` (tool selection) into a single, embeddable component for MCP server setup. Also fixed two issues in the setup reducer: the `submitting` variant was silently dropping `missingVariables` (causing form flash-unmounts), and submission failures left entries stuck with no retry path.

## Problem Statement

Phase 2 of the MCP server setup flow requires a per-server configuration panel that users drill into from the `McpServerPicker`. This panel must show a credentials form when the server needs environment variables, and a tool selector for customizing which tools to enable. The panel is a composition component — it assembles the `EnvVarForm` (Phase 0) and `McpToolSelector` (T02.1) building blocks with a header and state-driven layout.

### Pain Points

- No per-server configuration UI existed — users had no way to provide credentials or customize tool selection inline
- The reducer's `submitting` variant dropped `missingVariables`, causing the credentials form to flash-unmount during async credential saves
- On submission failure, entries got stuck in `submitting` status with no error recovery path — `submitEnvVars()` guards against non-`needsSetup` entries, creating a dead end

## Solution

Built `McpServerConfigPanel` as a pure presentational component with decomposed, SDK-first props. Fixed the reducer by adding `missingVariables` to the `submitting` variant and introducing a `SUBMIT_FAIL` action for clean error recovery.

## Implementation Details

### McpServerConfigPanel (new, 260 lines)

**Props design — decomposed with grouped `credentials?`:**

The component accepts flat props rather than a `McpServerSetupEntry` from the reducer. Credential-related props are grouped into an optional `credentials?` sub-object. When `credentials` is provided, the form is shown and the tool selector is disabled (progressive disclosure). When omitted, only the tool selector renders — active and editable.

This decoupling means platform builders can use `McpServerConfigPanel` with any state management approach, not just our reducer/hook.

**No "Apply" button:**

The master plan wireframe included an "Apply" button. This was removed because `EnvVarForm` already has its own "Save"/"Use once" submit button, and tool selection changes fire immediately (they're local state with no API call). A batch "Apply" would fight `EnvVarForm`'s component contract and add complexity for zero user benefit.

**Layout:**
- Header: back button + optional server icon + name + truncated description
- Credentials form (conditional): `EnvVarForm` with `title="Credentials required"`, no `onCancel` (panel header Back button suffices)
- Tool selector (always): `McpToolSelector`, disabled while credentials are pending
- Error display: inline `role="alert"` for accessibility

### Reducer fixes

**DD-R10 — `submitting` carries `missingVariables`:** The `SUBMIT_START` handler already guards from `needsSetup` (which has `missingVariables`), so forwarding it to `submitting` is a one-line addition. The form stays visible/disabled during the async save.

**DD-R11 — `SUBMIT_FAIL` action:** New action that transitions `submitting → needsSetup` with the error preserved and `missingVariables` restored. The hook's catch block uses `SUBMIT_FAIL` instead of `SET_ERROR`, enabling users to see the inline error and retry.

## Benefits

- **Complete config panel**: Users can now configure MCP server credentials and tool selection in a single drill-in view
- **Error recovery**: Submission failures no longer create dead-end states — users see the error and can retry immediately
- **SDK-first**: Platform builders can embed `McpServerConfigPanel` with any state management, not just the Stigmer reducer
- **Progressive disclosure**: Tool selector is visible but disabled while credentials are pending, giving context without cognitive overload
- **Accessibility**: `role="region"` with `aria-label`, `role="alert"` for errors, back button with explicit `aria-label`

## Impact

- **SDK consumers**: New `McpServerConfigPanel`, `McpServerConfigPanelProps`, and `McpServerCredentialsProps` exports available from `@stigmer/react`
- **Internal (T02.3)**: `McpServerPicker` can now drill into this panel for per-server configuration
- **Reducer API**: `SUBMIT_FAIL` added to `McpServerSetupAction` union, `missingVariables` added to `submitting` variant — both additive, no breaking changes

## Related Work

- [MCP Tool Selector Component](2026-03-20-143246-mcp-tool-selector-component.md) — T02.1, the tool checklist composed by this panel
- Phase 0 (EnvVarForm extraction) — the credentials form composed by this panel
- Phase 1 (reducer + hook) — the state machine this panel renders against
- Next: T02.3 will enhance `McpServerPicker` with setup indicators and drill-in to this panel

---

**Status**: Production Ready
**Timeline**: Session 5 (planning + implementation)
