# Agent Execution Viewer Redesign: SessionViewer + Tabbed Inspector

**Date**: May 29, 2026

## Summary

Replaced the agent session page's stacked four-widget sidebar with a `SessionViewer` SDK organism — a graph-less analog of `WorkflowExecutionViewer` — that pairs the conversation column with a resizable, tabbed `SessionInspector`. The inspector hosts persistent session facets (Plan, Changes, Artifacts, Usage) backed by existing proto status fields, plus a selection-driven Inspect facet. Both web and desktop client apps are now thin shells consuming the same SDK component (DD-016 parity).

## Problem Statement

The agent session detail page rendered a fixed `w-80` aside column with four independently null-guarded widget cards (`ExecutionProgress`, `UsageWidget`, `WriteBacksWidget`, `ArtifactsWidget`) that had three critical deficiencies:

### Pain Points

- **No organizing principle**: widgets stacked vertically with no hierarchy, no selection model, and independent null-guards competing for vertical space
- **Invisible on smaller viewports**: the aside used `hidden lg:flex`, completely hiding execution state below the `lg` breakpoint — a direct violation of Nielsen's Visibility of System Status heuristic
- **Not scalable**: adding new facets (e.g., file diffs, context window health) required adding more cards to an already-overcrowded column
- **Architectural divergence**: the workflow execution view had a polished tabbed inspector (`ExecutionInspector`) with contextual tabs, badges, and a selection model — the agent view had none of this
- **SDK/client code duplication**: both web (`SessionPage.tsx`) and desktop (`SessionPage.tsx`) duplicated ~160 lines of identical layout, widget wiring, error banners, and composer configuration

## Solution

Extracted a full `SessionViewer` SDK organism in `@stigmer/react` that owns `useSessionPageFlow` internally and composes:

1. **Conversation column** (primary pane): `MessageThread` + error banners + `SessionComposer`
2. **SessionInspector** (secondary pane): always-visible run-status header + tabbed facets (Plan / Changes / Artifacts / Usage / Inspect)

Connected via the existing `ResizableSplit` with persisted width. Thread selection uses a new `SelectionStore` external store (mirroring `ConversationStore`) with per-item `useSyncExternalStore` boolean selectors for render isolation.

## Implementation Details

### New SDK Files (14)

**Render-isolation foundation:**
- `sdk/react/src/internal/store/selection-store.ts` — `SelectionStore` class with `select()`, `deselect()`, `toggle()`, `isSelected(kind, id)`, full `useSyncExternalStore` contract
- `sdk/react/src/execution/ThreadSelectionContext.tsx` — React context carrying stable store ref (not value)
- `sdk/react/src/execution/useThreadSelection.ts` — per-item boolean hook + `useSelectedThreadItem()` for the InspectTab

**SessionViewer organism:**
- `sdk/react/src/session/SessionViewer.tsx` — top-level organism with `ResizableSplit`, responsive hiding below `lg` without remounting

**SessionInspector + facets:**
- `sdk/react/src/session/inspector/SessionInspector.tsx` — memo'd tabbed panel with always-visible run-status header
- `sdk/react/src/session/inspector/useSessionInspector.ts` — tab FSM mirroring `ExecutionInspector` (deriveAutoTab, userPickedTabRef, buildVisibleTabs)
- `sdk/react/src/session/inspector/{PlanTab,ChangesTab,ArtifactsTab,UsageTab,InspectTab}.tsx` — chrome-less facet wrappers
- `sdk/react/src/session/inspector/index.ts` — barrel

**Tests:**
- `sdk/react/src/internal/store/__tests__/selection-store.test.ts` — 12 tests
- `sdk/react/src/session/inspector/__tests__/useSessionInspector.test.ts` — 11 tests (FSM + buildVisibleTabs)

### Edited Files (7)

- `sdk/react/src/execution/ToolCallItem.tsx` — opt-in selection ring + inspect button via `useThreadSelection`
- `sdk/react/src/execution/SubAgentSection.tsx` — same selection affordance
- `sdk/react/src/internal/store/index.ts` — exports `SelectionStore` + `SelectedThreadItem`
- `sdk/react/src/session/index.ts` — exports `SessionViewer`, `SessionInspector`, types
- `sdk/react/src/index.ts` — top-level re-exports for all new public APIs
- `client-apps/web/src/domain/session/SessionPage.tsx` — reduced to thin shell
- `client-apps/desktop/src/pages/SessionPage.tsx` — same thin shell (DD-016 parity)

### Key Design Decisions

- **SelectionStore over React context value**: avoids re-rendering all selectable rows on selection change (DD-009/010 streaming contract preserved)
- **DD-011 opt-in**: `ThreadSelectionContext` defaults to absent; when absent, `useThreadSelection` returns null and existing behavior is unchanged
- **Tab FSM mirrors ExecutionInspector exactly**: adjust-state-during-render pattern with `prevPhase`/`prevSelected` shadow state and `userPickedTabRef` for sticky manual picks
- **headerActions slot (DD-004)**: Share/PermissionGate stays in client apps, not SDK; injected via ReactNode slot

## Benefits

- **Organized information architecture**: four independent widgets replaced by a tabbed panel with contextual visibility and count badges
- **Visible on all viewports**: responsive hiding keeps the inspector mounted but hidden below `lg` — no scroll/state loss on breakpoint transitions
- **Scalable facet system**: adding new facets (file diffs, context window, etc.) is a single tab addition to `buildVisibleTabs`
- **SDK-first (DD-001)**: `SessionViewer` is a public SDK export usable by platform builders, not a Console-only component
- **Client parity (DD-016)**: web and desktop wire `SessionViewer` identically, differing only in platform-specific hooks
- **Streaming render isolation preserved**: `SelectionStore` ensures selection changes re-render at most 2 rows (previous + newly selected)
- **23 new tests**: `SelectionStore` (12) + `useSessionInspector` FSM + `buildVisibleTabs` (11)

## Impact

- **SDK consumers** (`@stigmer/react`): new public exports `SessionViewer`, `SessionInspector`, `useSessionInspector`, `buildVisibleTabs`, `SelectedThreadItem`
- **Web console** (`client-apps/web`): `SessionPage.tsx` reduced from 253 to ~90 lines
- **Desktop app** (`client-apps/desktop`): `SessionPage.tsx` reduced from 232 to ~80 lines
- **Existing widgets**: `UsageWidget`, `ArtifactsWidget`, `WriteBacksWidget`, `ExecutionProgress` remain exported (public API stability) — Console composes them via facets

## Related Work

- Mirrors the `WorkflowExecutionViewer` + `ExecutionInspector` architecture from the workflow execution view
- Reuses `Tabs` (WAI-ARIA) and `ResizableSplit` SDK primitives
- Follows `ConversationStore` / `WorkflowExecutionEventStore` external store pattern for `SelectionStore`

---

**Status**: ✅ Production Ready
**Timeline**: Single session implementation
