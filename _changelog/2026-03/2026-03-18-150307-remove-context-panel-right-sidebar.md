# Remove ContextPanel Right Sidebar from Console

**Date**: March 18, 2026

## Summary

Removed the ContextPanel right sidebar infrastructure from the Console's AppShell, converting the session page from a three-column layout to a clean two-column layout (left sidebar + main content). This is Phase 1 of the session page single-canvas redesign, eliminating the fragmented "three disconnected blocks" feel in favor of a unified content area.

## Problem Statement

The session detail page used a three-column layout: left sidebar for session history, main content for the message thread, and a right "Details" sidebar for execution metadata. The right sidebar created a fragmented user experience with its own background, header chrome, close button, and scroll area — three disconnected visual blocks instead of one cohesive surface.

### Pain Points

- Right sidebar felt disconnected from the main content — separate panel with its own visual identity
- The slot mechanism (`ContextPanelSlotProvider`, `useContextPanelSlot`) added architectural complexity for a Console-specific concern
- Panel chrome (header, close button, scroll wrapper) consumed space without adding proportional value
- Auto-open behavior coupled the SessionPage to the layout system via `useContextPanelOpen`

## Solution

Surgically removed all ContextPanel infrastructure from the Console layout layer. Four files modified, one file deleted, zero SDK changes. The AppShell now renders a two-column layout: collapsible left sidebar + main content area.

## Implementation Details

### Files Changed

- **Deleted** `ContextPanel.tsx` — 43-line sidebar component, single-purpose, no other consumers
- **Gutted** `use-layout-state.tsx` — Removed ~100 lines of ContextPanel state management (visibility store, slot contexts, provider, hooks). File now contains only sidebar visibility logic (55 lines)
- **Simplified** `AppShell.tsx` — Removed `ContextPanelSlotProvider` wrapper, `ContextPanelContainer` component, and all related imports. Clean two-column layout (70 lines)
- **Cleaned** `SessionPage.tsx` — Removed `ExecutionDetails` import, slot injection, auto-open effect, `activeExecution` memo, and unused React imports (`useMemo`, `useRef`)

### Consumer Analysis

Verified that only 3 source files consumed the ContextPanel mechanism. `Sidebar.tsx` imports only `useSidebarOpen` — completely unaffected. No barrel exports exist for the layout directory.

### What Was Preserved

- `@stigmer/react` — `ExecutionDetails` component remains exported and available for backward compatibility
- Left sidebar infrastructure — `useSidebarOpen`, `Sidebar.tsx`, all sidebar styling untouched
- All SDK packages — zero changes to `@stigmer/react`, `@stigmer/theme`, or `@stigmer/sdk`

## Benefits

- Simpler layout architecture — one fewer panel, no slot mechanism overhead
- Cleaner separation — Console layout no longer needs a content injection system
- Foundation for Phase 3 — the single-canvas layout is the structural prerequisite for inline metadata widgets

## Impact

- **Console users**: Right sidebar no longer appears. Execution metadata is temporarily absent until Phase 3 reintroduces it as inline widgets within the main content area.
- **SDK consumers**: No impact. All `@stigmer/react` exports remain unchanged.
- **Codebase**: Net deletion of ~200 lines across 4 files. One file removed entirely.

## Related Work

- Part of project `20260318.03.session-page-redesign` — Phase 1 of 4
- Phase 2: Decompose `ExecutionDetails` into compact widget components
- Phase 3: Redesign SessionPage layout with inline widgets
- Phase 4: Theme token alignment

---

**Status**: Production Ready
**Timeline**: Phase 1 of session page redesign
