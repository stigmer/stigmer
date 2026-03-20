# SessionComposer Submission Blocking for Unconfigured MCP Servers

**Date**: March 20, 2026

## Summary

Added submission blocking to `SessionComposer` that prevents session creation when MCP servers have unconfigured credentials. The send button and Enter-to-submit are gated by a `canSend` signal derived from the MCP setup hook's `allReady` state, and an amber warning banner guides users to complete configuration.

## Problem Statement

After wiring `useMcpServerSetup` into the SessionComposer (T03.1), users could select MCP servers that required credentials but still submit a session. This would result in runtime `FAILED_PRECONDITION` errors when the agent runner tried to start the unconfigured MCP server processes.

### Pain Points

- Users could submit sessions with partially configured MCP servers
- No visual feedback explaining why a session might fail
- Both button click and Enter-to-submit pathways were unguarded
- The `useMcpServerSetup.allReady` signal existed but wasn't consumed

## Solution

Derived a `canSend` boolean from the existing `composer.canSubmit` and `mcpSetup.allReady` signals, then applied it to both the send button and a keyboard event override. Added an amber warning banner (Zone 2.5) between the chips area and toolbar that only appears when servers are in `needsSetup` status — the user-actionable state requiring credential input.

## Implementation Details

**Single file changed**: `sdk/react/src/composer/SessionComposer.tsx` (+64/-2 lines)

**Blocking logic**:
- `mcpBlocked = showMcp && !mcpSetup.allReady` — true when any MCP entry isn't `ready`
- `canSend = composer.canSubmit && !mcpBlocked` — combined submission gate
- Send button uses `disabled={!canSend}` instead of `disabled={!composer.canSubmit}`
- `handleTextareaKeyDown` intercepts Enter when `!canSend`, delegates to composer's handler otherwise

**Warning banner**:
- Rendered between chips (Zone 2) and toolbar (Zone 3) when `needsSetupCount > 0`
- Amber `bg-warning/10` background with `text-warning` text
- Pluralized message: "1 MCP server needs configuration" / "N MCP servers need configuration"
- "Configure" button opens the MCP popover via existing controlled state
- `role="status"` for screen reader announcement

**Design decisions**:
- **DD-T03.4**: `allReady` for blocking (catches `loading`/`needsSetup`/`submitting`), `needsSetupCount` for warning (only user-actionable states)
- **DD-T03.5**: `onKeyDown` override keeps `useComposer` public API unchanged
- **DD-T03.6**: Zone 2.5 placement contextualizes the warning between cause (chips) and effect (send button)

## Benefits

- Prevents runtime credential errors by blocking submission proactively
- Clear, non-alarming UX: transient states block silently, actionable states show a warning
- One-click navigation to MCP configuration via the "Configure" button in the warning
- Zero public API changes — no new props on `SessionComposerProps`, no changes to `useComposer`

## Impact

- **End users**: Cannot accidentally submit sessions with unconfigured MCP servers. Warning explains what to do.
- **SDK consumers**: No prop changes. Blocking is internal to `SessionComposer`. Platform builders using `useComposer` directly are unaffected.
- **Architecture**: Consumes the `allReady`/`needsSetupCount` signals that were designed for this purpose in T01.2.

## Related Work

- [Wire MCP Setup into SessionComposer](2026-03-20-154138-wire-mcp-setup-into-session-composer.md) — Phase 3, T03.1
- [MCP Server Setup Orchestration Hook](2026-03-20-141555-mcp-server-setup-orchestration-hook.md) — Phase 1, T01.2 (provided `allReady`/`needsSetupCount`)

---

**Status**: ✅ Production Ready
**Timeline**: Phase 3, T03.2 of the MCP Server Setup Flow project
