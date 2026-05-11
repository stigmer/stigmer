# Fix Session Config Visibility in Follow-Up Composer

**Date**: May 11, 2026

## Summary

MCP server chips now appear in the follow-up composer, the default agent is shown as a non-removable chip, and `ContextChip` supports a readonly variant. This closes the gap between session-spec hydration (done previously in `useSessionPageFlow`) and the composer's internal rendering, which was sourcing chips from an empty internal state machine instead of the hydrated prop.

## Problem Statement

After the initial MCP/skill hydration fix (May 10), `useSessionPageFlow` correctly populated `mcpServerUsages` from the session spec. However, `SessionComposer` renders MCP chips from its internal `useMcpServerSetup` state — not from the incoming `mcpServerUsages` prop. Since `useMcpServerSetup` starts empty and was never seeded from the prop, chips never appeared in the follow-up composer.

A secondary issue: the default agent was intentionally excluded from the chip bar (the code only set `agentRef` for non-default agents), leaving users with no visibility into which agent the session was using.

### Pain Points

- MCP chips missing in follow-up composer despite correct hydration at the flow level
- One-way sync effect (`onMcpServerUsagesChange`) pushed empty internal state back to the parent during component mount, temporarily competing with hydration
- Default agent invisible — users couldn't tell which agent was bound to the session
- No way to render a non-removable chip (all chips had a mandatory X button)

## Solution

Three coordinated changes, all in the SDK layer for desktop/web parity:

1. **Seed internal MCP state from prop** — A one-time `useEffect` in `SessionComposer` calls `mcpSetup.addServer()` for each entry in `mcpServerUsages` on mount, then restores `enabledTools` after each server resolves.
2. **Guard sync effect during seeding** — The existing sync effect that pushes `mcpSetup.usageInputs` outward now skips when any MCP entry is in `loading` status, preventing empty-state overwrites.
3. **Default agent as readonly chip** — `useSessionPageFlow` always sets `agentRef` (even for the default agent) and exposes an `isDefaultAgent` flag. `SessionComposer` uses this to render the default agent chip without an X button.

## Implementation Details

### `ContextChip.tsx`
- `ChipItem.onRemove` changed from required to optional
- When `onRemove` is absent, the X button is hidden and the chip gets `opacity-80` styling
- Supports future readonly chip use cases beyond the default agent

### `SessionComposer.tsx`
- New `isDefaultAgent` prop (default `false`) controls whether the agent chip is removable
- `initialMcpSeeded` ref prevents re-seeding after the first mount
- Stable refs (`mcpSetupAddServerRef`, `mcpSetupSetEnabledToolsRef`) avoid stale closures in the seeding effect
- `hasLoadingMcpEntries` memo gates the sync effect while servers are resolving
- Agent chip `onRemove` is `undefined` when `isDefaultAgent` is true

### `useSessionPageFlow.ts`
- Removed the `if (!isDefault)` guard that prevented `agentRef` from being set for the default agent
- Added `isDefaultAgent` state, set during the one-time agent init block
- Exposed `isDefaultAgent: boolean` in the return type

### Client Apps
- Both `client-apps/desktop/src/pages/SessionPage.tsx` and `client-apps/web/src/domain/session/SessionPage.tsx` pass `isDefaultAgent={flow.isDefaultAgent}` to `SessionComposer`

## Benefits

- **Recognition over recall** (Nielsen #6): users see exactly which MCP servers and agent are active in every follow-up
- **No confusing loops**: default agent chip is non-removable — removing it would just re-select the same agent
- **Consistent state**: internal chip rendering and external flow state are always in sync
- **SDK-level parity** (DD-016): all changes in `@stigmer/react`, both client apps benefit automatically

## Impact

- **Session pages** (desktop + web): MCP chips and default agent chip now appear correctly on follow-up messages
- **Embedders** using `SessionComposer`: new `isDefaultAgent` prop available for custom session UIs
- **Future readonly chips**: any chip type can now omit `onRemove` for non-interactive display

## Related Work

- [Session Composer: Hydrate MCP and Skills on Follow-Up](_changelog/2026-05/2026-05-10-165430-session-composer-follow-up-mcp-skill-hydration.md) — prerequisite: hydrated session spec into flow state
- [Desktop-Web Session Composer Parity](_changelog/2026-05/2026-05-09-134857-desktop-web-session-composer-parity.md) — established the prop wiring pattern both session pages share

---

**Status**: ✅ Production Ready
