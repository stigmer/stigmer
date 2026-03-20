# Composer Toolbar: Two-Tier Redesign and Decomposition

**Date**: March 20, 2026

## Summary

Redesigned the SessionComposer toolbar with a two-tier layout that separates per-message input actions (Attach, Workspace) from agent-level configuration (Agent, MCP, Skills, Secrets) behind a single "Configure" menu. Simultaneously decomposed the 1,347-line monolith into six focused modules, improving maintainability without changing the public API surface.

## Problem Statement

The SessionComposer toolbar presented all actions as a flat row with no logical ordering:

```
Attach | Agent | Workspace | MCP | Skills | Secrets | --- | Model | [Send]
```

### Pain Points

- **No ordering rationale** — Items were arranged by implementation date, not by frequency of use or conceptual grouping. This violated Hick's Law (more visible choices slow decisions) and Gestalt proximity (related items should be grouped).
- **Blueprint/runtime conflation** — Agent, MCP, and Skills are agent-level blueprint configuration, but they appeared alongside per-message controls (Attach) in the same visual row, blurring the architectural separation between blueprint and runtime that the platform enforces everywhere else.
- **Scalability** — Adding more capabilities would make the toolbar grow without bound. No progressive disclosure mechanism existed.
- **Embeddability burden** — Platform builders who embedded the composer but didn't need agent/MCP/skill configuration still saw all the buttons, and had to pass props to hide each one individually.
- **Maintainability** — `SessionComposer.tsx` was a 1,347-line monolith containing the component logic, all icons, helper components, and rendering in a single file.

## Solution

### Two-Tier Toolbar

Applied a frequency-of-interaction principle with blueprint/runtime separation:

**Tier 1 (always visible):** Attach, Workspace — per-message and per-session controls the user touches most often.

**Tier 2 (behind Configure menu):** Agent, MCP Servers, Skills, Secrets — agent-level configuration selected once per session, hidden behind a single affordance.

**Right edge:** Model Selector, Send — least-changed settings and primary action.

Visual separators (1px dividers) placed between conceptual groups using Gestalt proximity.

### Drill-Down Configure Menu

The Configure menu uses a single popover with content switching (not nested popovers, which cause z-index and focus-trap issues):

1. Click Configure → menu list shows available items with counts and warning indicators
2. Click an item → popover content switches to that item's picker (AgentPicker, McpServerPicker, etc.)
3. Back button returns to the menu list

The trigger button displays a total badge count and an amber warning dot when any MCP server needs setup.

### Component Decomposition

The monolith was split into six focused modules:

| File | Lines | Responsibility |
|------|-------|----------------|
| `SessionComposer.tsx` | 983 | Orchestrator: state management, submit logic, chip aggregation |
| `ComposerToolbar.tsx` | 169 | Toolbar layout with tier separation and visual grouping |
| `ConfigureMenu.tsx` | 237 | Drill-down popover: menu list and panel content switching |
| `ContextChip.tsx` | 104 | Chip rendering for selected context items |
| `ContextPopover.tsx` | 54 | Reusable popover trigger wrapper |
| `icons.tsx` | 253 | All SVG icons including new ConfigureIcon |

## Implementation Details

### New Components

- **`ConfigureMenu`** — Fully controlled via `open`, `onOpenChange`, `activePanel`, `onActivePanelChange`. Renders either a menu list or the active panel's picker via `renderPanel` callback. Computes total badge and warning state from items array. Zero knowledge of specific pickers — pure presentation.

- **`ComposerToolbar`** — Receives slot-like props for complex content (`workspaceContent`, `renderConfigPanel`). Renders Tier 1 items directly (Attach button, Workspace popover), delegates Tier 2 to ConfigureMenu, and places ModelSelector and Send button on the right edge. Separators are conditionally rendered based on which groups are populated.

- **`ConfigureIcon`** — Horizontal sliders icon signaling "configuration" without conflating with "add content" (which Attach handles).

### State Changes in SessionComposer

- Removed `agentPopoverOpen` and `mcpPopoverOpen` states
- Added `configOpen` (boolean) and `configActivePanel` (string | null)
- Agent setup cleanup (`agentSetup.reset()`) triggers when navigating away from the agent panel or closing the menu
- MCP warning "Configure" button and MCP chip `onClick` (for `needsSetup` chips) open ConfigureMenu drilled into the MCP panel

### Public API

Zero changes to `SessionComposerProps`, `SessionComposerSubmitContext`, or `useComposer`. The barrel export (`composer/index.ts`) continues to export only the public symbols. All new files are internal to the composer module.

## Benefits

- **Cleaner default composer** — Platform builders passing no agent/MCP/skill/secrets props get: `[Attach] [Workspace] [Model] [Send]`
- **Scalable** — New configuration items can be added to the Configure menu without touching the toolbar layout
- **Better embeddability** — A single `showConfiguration={false}` equivalent (just don't pass Tier 2 props) hides all configuration
- **Maintainable** — Each file has a single responsibility; no file exceeds 250 lines of rendering logic
- **Consistent with platform architecture** — The UI now reflects the blueprint/runtime boundary that the backend enforces

## Impact

- **SDK consumers** — No breaking changes. All existing `SessionComposer` usage works unchanged.
- **Console** — `SessionLauncher.tsx` and `SessionPage.tsx` require zero modifications.
- **Platform builders** — Cleaner default experience; configuration surfaces naturally through the Configure menu when agent/MCP/skill props are provided.

## Related Work

- SessionComposer file attachment support (previous session)
- ArtifactPreviewModal component (previous session)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
