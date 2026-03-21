# MCP Configure Auto-Navigate for Single Server

**Date**: March 21, 2026

## Summary

When only one MCP server needs configuration, clicking "Configure" on the warning banner or an MCP chip now navigates directly to that server's configuration panel, eliminating an unnecessary intermediate list view.

## Problem Statement

Clicking "Configure" on the MCP warning banner or a `needsSetup` MCP chip always opened the `McpServerPicker` in list view. Even when there was only one MCP server needing configuration, the user had to click "Configure" a second time on the server row to reach the actual configuration panel.

### Pain Points

- Two clicks required when one would suffice (Hick's Law violation — presenting a choice when there is no meaningful choice)
- Warning banner explicitly states "1 MCP server needs configuration" but then shows a list of 1 item
- MCP chip click indicates intent to configure a specific server but still shows the list

## Solution

Added an `initialServerKey` prop to `McpServerPicker` that, when provided, initializes the component directly in the configure view for the specified server instead of the list view.

## Implementation Details

**`McpServerPicker.tsx`**: Added optional `initialServerKey?: string` prop to `McpServerPickerProps`. The `useState` initializer for the internal `view` state uses this prop to start in configure view when a key is provided. The existing guard that resets to list view when an entry is `loading` or missing provides safety for edge cases.

**`SessionComposer.tsx`**: Added a `useRef<string | undefined>` to hold the initial server key as a one-shot initialization hint. Three entry points are handled differently:

- **Warning banner**: When `needsSetupCount === 1`, finds the single `needsSetup` entry key and passes it through
- **MCP chip**: Uses the chip's own server key directly (the user clicked on a specific server)
- **Toolbar menu**: No change — intentional browse action

The ref is cleared when the config popover closes to prevent stale values.

## Benefits

- One fewer click for the most common MCP configuration path (single server)
- MCP chip clicks now go directly to the server the user tapped
- No behavioral change for multi-server scenarios or toolbar browsing
- `initialServerKey` prop is available to platform builders embedding `McpServerPicker`

## Impact

- **SDK (`@stigmer/react`)**: New optional prop on `McpServerPicker` — backward-compatible, no breaking changes
- **Console**: Immediate UX improvement for single-server MCP configuration
- **Platform builders**: Can use `initialServerKey` to control initial picker view in their integrations

## Related Work

- `2026-03-20-151839-mcp-server-picker-setup-integration.md` — Original `McpServerPicker` setup mode
- `2026-03-20-154138-wire-mcp-setup-into-session-composer.md` — MCP setup wiring in composer

---

**Status**: Production Ready
