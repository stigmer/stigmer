# Unified Session Setup Panel: Interactive Inspector + Launcher Parity

**Date**: May 29, 2026

## Summary

Unified the new-session launcher and existing-session viewer around a single persistent Setup/Workspace inspector panel. Setup is now the default tab when idle or ready for follow-up, the panel is interactive (add/remove workspace, agent, MCP, skills), the redundant composer chip row is removed, and a new `NewSessionViewer` SDK organism brings the inspector to the launcher with progressive disclosure. Both web and desktop client apps are thin shells consuming the same SDK organisms (DD-016 parity).

## Problem Statement

The Session Viewer's configuration surfaces were fragmented across three disconnected affordances: transient toolbar popovers, a read-only Setup tab, and a redundant chip row in the composer. The launcher had no inspector at all, making workspace and config state invisible after selection.

### Pain Points

- **Invisible workspace state**: The chosen workspace lived only in an ephemeral popover — no persistent "this is your session's context" surface in the launcher. Users had to re-open the popover to remember what was attached.
- **Redundant state representations**: Composer chips and the Setup tab showed the same agent/MCP/skill state — two read-only representations of one truth competing for attention.
- **Launcher/session inconsistency**: The launcher was a bare centered composer with no inspector panel, while the session page had a full tabbed inspector — violating Consistency (Nielsen #4).
- **No interactive Setup panel**: The Setup tab was read-only. Removing an agent or workspace entry required hunting for the correct popover or chip.
- **`deriveAutoTab` defaulted to Plan always**: Even when no execution was running or when the execution completed, the inspector showed the Plan tab (often empty or stale) instead of the more useful Setup configuration view.

## Solution

Four coordinated changes delivered as a single Phase 1:

1. **Setup as default tab** — `deriveAutoTab` now returns `"setup"` when idle (phase=null) or terminal, `"plan"` while actively running. Phase transitions to terminal state reset the user's tab pick and auto-switch to Setup.

2. **Interactive SetupTab + Workspace section** — Extended `SetupTabProps` with optional `workspaceActions` and `mutations` interfaces (DD-011 backward compatible). When callbacks are provided, items render inline remove buttons; when absent, sections stay read-only. Added a Workspace section with entry list, remove buttons, and Browse Folder / Connect GitHub actions.

3. **Dropped composer chip row** — Removed the 130+ line `chips` useMemo, the Zone 2 render block, and unused chip-removal callbacks. Kept attachment chips (per-message ephemeral), agent/MCP warning banners (blocking), and all interactive toolbar triggers.

4. **NewSessionViewer organism** — New SDK organism that owns `useNewSessionFlow` and composes `SessionComposer` + `SessionInspector` (Setup-only) with progressive disclosure: inspector panel appears only when context is attached. Both web and desktop launchers reduced to thin shells.

## Implementation Details

### New SDK Files (1)

- `sdk/react/src/session/NewSessionViewer.tsx` — Launcher organism with `ResizableSplit`, progressive inspector reveal, all workspace/config threading

### Edited SDK Files (7)

- `sdk/react/src/session/inspector/useSessionInspector.ts` — `deriveAutoTab` phase-aware logic, deselection fallback uses `deriveAutoTab` instead of hard-coded `"plan"`, effective-tab fallback uses `deriveAutoTab`
- `sdk/react/src/session/inspector/SetupTab.tsx` — Full rewrite: added `SetupTabWorkspaceActions`, `SetupTabMutationCallbacks` interfaces, `WorkspaceSection` with entry list + add actions, `RemoveButton` affordances on all config sections, inline SVG icons (SDK independence)
- `sdk/react/src/session/inspector/SessionInspector.tsx` — Updated JSDoc for `sessionConfig` prop
- `sdk/react/src/session/SessionViewer.tsx` — `InspectorPanel` receives and threads workspace/mutation props, added `ResourceRef` import
- `sdk/react/src/composer/SessionComposer.tsx` — Removed `chips` useMemo, Zone 2 render, `handleAgentChipRemove`/`handlePendingAgentChipRemove` callbacks, `ContextChip`/`ChipItem` import
- `sdk/react/src/session/inspector/index.ts` — Barrel exports for new types
- `sdk/react/src/session/index.ts` — Barrel exports for `NewSessionViewer` and new types
- `sdk/react/src/index.ts` — Top-level barrel exports

### Edited Client-App Files (2)

- `client-apps/web/src/domain/session/SessionLauncher.tsx` — Reduced to thin shell consuming `NewSessionViewer` (keeps draft params, edit prep, GitHub connection, navigation)
- `client-apps/desktop/src/pages/SessionLauncher.tsx` — Same thin shell pattern (keeps draft params, native folder picker, navigation)

### Tests

- `sdk/react/src/session/inspector/__tests__/useSessionInspector.test.ts` — Updated 7 existing tests for phase-aware defaults, added 2 new tests: "switches to setup when terminal" and "reverts to plan when deselect during running"
- All 134 session/composer tests pass; TypeScript compilation clean

### Key Design Decisions

- **DD-011 opt-in**: `workspaceActions` and `mutations` are optional props; when absent, SetupTab renders read-only. Existing SDK consumers see no behavior change.
- **Progressive disclosure in launcher**: `NewSessionViewer` renders the inspector panel only when `hasContext` is true (any workspace/agent/MCP/skill/vars attached). Empty launcher stays the clean centered composer.
- **Attachment chips preserved**: Per-message ephemeral attachments remain at the composer because they are scoped to the message being typed, not to session config. Warning banners also preserved for blocking states.
- **Phase-aware tab FSM**: `deriveAutoTab` priority: `selectedItem` -> inspect, `phase == null || isTerminalPhase` -> setup, actively running -> plan. The fallback tab also uses `deriveAutoTab` instead of hard-coded "plan".

## Benefits

- **Single source of truth**: Session config visible in one persistent panel instead of scattered across chips, popovers, and a read-only tab
- **Launcher/session parity**: Both surfaces share the same inspector panel architecture
- **Interactive config management**: Remove agent, MCP servers, skills, and workspace entries directly from the Setup panel
- **Reduced composer complexity**: ~150 lines of chip-related code removed from SessionComposer — fewer re-renders, simpler maintenance
- **SDK-first (DD-001)**: `NewSessionViewer` and all SetupTab extensions are public SDK exports usable by platform builders
- **Client parity (DD-016)**: Both web and desktop consume `NewSessionViewer` identically, differing only in platform-specific hooks

## Impact

- **SDK consumers** (`@stigmer/react`): New public exports `NewSessionViewer`, `NewSessionViewerProps`, `SetupTabWorkspaceActions`, `SetupTabMutationCallbacks`. Existing `SetupTabProps` extended with optional fields (backward compatible).
- **Web console** (`client-apps/web`): `SessionLauncher.tsx` reduced from ~180 to ~120 lines
- **Desktop app** (`client-apps/desktop`): `SessionLauncher.tsx` reduced from ~168 to ~125 lines
- **Existing consumers**: All changes are backward compatible (opt-in props, additive exports)

## Related Work

- Builds on the `SessionViewer` + `SessionInspector` redesign (changelog `2026-05-29-123533`)
- Builds on the `SetupTab` introduction (changelog `2026-05-29-130521`)
- Builds on workspace source centralization (changelog `2026-05-29-130720`)
- Phase 2 (live file explorer) deferred pending Tauri FS plugin + GitHub trees API capability

---

**Status**: Production Ready
**Timeline**: Single session implementation
