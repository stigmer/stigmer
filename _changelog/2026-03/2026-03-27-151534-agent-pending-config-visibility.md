# Agent Pending Configuration Visibility

**Date**: March 27, 2026

## Summary

Brought agent chip UX to parity with MCP server chips for the "needs configuration" state. When an agent is selected but requires environment variables, the session composer now shows an amber warning chip, an inline warning banner, and auto-opens the Configure panel — eliminating the silent failure where the user got zero visual feedback.

## Problem Statement

When clicking "Create MCP Server" from the Library (or any draft creation flow), the session composer auto-selected the creator agent via `initialAgentRef`. If that agent required environment variables (e.g., `STIGMER_SERVER_ADDRESS`, `STIGMER_API_KEY`), the resolution landed on `needsEnvVars` — but the UI produced **no visible feedback**:

- No agent chip appeared (the chip list derived solely from the parent `agentRef` prop, which was only set on `ready`)
- No warning banner was shown
- The Configure panel did not auto-open
- The contextual placeholder was not set

The user saw a blank session composer as if nothing had happened. Meanwhile, MCP servers already handled this correctly with amber warning chips, a "needs configuration" banner, and clickable chips that opened the Configure panel.

### Pain Points

- Users had no indication that an agent was pre-selected but needed configuration
- The "Create MCP Server" flow appeared broken — no agent chip, no contextual prompt
- The asymmetry between agent and MCP server handling was confusing and inconsistent
- Manual discovery was required: the user had to open Configure > Agent to find the pending env form

## Solution

Extended the `SessionComposer` to render pending agent state (resolving, needsEnvVars, submitting) as visible chips with warning/loading status, mirroring the existing MCP server pattern. Added an inline warning banner and auto-open behavior for the initial agent draft flow.

## Implementation Details

### Pending Agent Chip

The `chips` useMemo now checks `agentSetup.state` when `agentRef` is null. For `resolving` → `"loading"` chip (spinner), for `needsEnvVars` → `"needsSetup"` chip (amber warning dot, clickable to open Configure > Agent), for `submitting` → `"submitting"` chip (spinner).

### Pending Agent Chip Remove Handler

A dedicated `handlePendingAgentChipRemove` callback calls `agentSetup.reset()` to properly clean up the internal state machine, unlike the existing `handleAgentChipRemove` which only clears the parent ref (already null in the pending case).

### Config Popover Close Protection

`handleConfigOpenChange` and `handleConfigActivePanelChange` no longer call `agentSetup.reset()` when the agent is in `needsEnvVars` or `submitting` state. This preserves the pending chip when the user closes the popover without completing the env form — matching MCP behavior where closing the popover does not remove unconfigured servers.

### Agent Setup Warning Banner (Zone 2.7)

An inline warning row identical in structure to the MCP warning banner, reading "Agent needs configuration before use" with a Configure button that opens the agent panel.

### Auto-Open Configure on Initial Agent

A one-shot effect fires when `initialAgentRef` is provided and the resolution lands on `needsEnvVars`, auto-opening the Configure panel to the Agent tab so the user immediately sees the env form in the draft flow.

### Configure Menu Item Update

The Agent item in the Configure menu now shows `count: 1` and `hasWarning: true` when an agent is pending configuration.

### ContextChip JSDoc

Widened `status`, `detail`, and `onClick` prop documentation from "MCP-only" to generic, since these props now also serve agent chips.

## Files Changed

**SDK layer (`@stigmer/react`):**

- `sdk/react/src/composer/SessionComposer.tsx` — chip logic, warning banner, auto-open effect, remove handler, config popover protection, configure menu item
- `sdk/react/src/composer/ContextChip.tsx` — JSDoc widening (implementation unchanged)

## Benefits

- Users get immediate visual feedback when an agent is selected but needs configuration
- The draft creation flows (Create Agent, Create Skill, Create MCP Server) now clearly communicate the pending state
- Agent and MCP server UX is consistent — both use the same chip warning pattern
- The Configure panel auto-opens in the draft flow, reducing clicks to reach the env form

## Impact

- **Direct users**: Agent selection with pending env vars is now visible and actionable. The "Create MCP Server" flow no longer appears broken.
- **Platform builders**: Improved feedback is automatic for anyone embedding `SessionComposer`. No new props, no changed callbacks, no breaking changes.
- **SDK surface**: No removed or renamed exports. `ContextChip` props widened from "MCP-only" to generic (non-breaking documentation change).

---

**Status**: ✅ Production Ready
