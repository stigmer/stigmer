# Task T01: Session Page Single-Canvas Redesign

**Created**: 2026-03-18
**Status**: PENDING REVIEW
**Type**: Refactoring / UX Redesign

## Problem Statement

The current session detail page uses a three-column layout (left sidebar | main content | right "Details" sidebar). The right sidebar creates a "three disconnected blocks" feel — it is a separate panel with its own background, header chrome, close button, and scroll area. The FollowUpInput at the bottom is either over-styled (heavy `bg-card` block) or invisible (when background is removed). The overall UX feels fragmented rather than cohesive.

**Inspiration**: Claude Code's "Cowork" mode uses a single-canvas approach — no right sidebar panel. Metadata (Progress, Downloads, Context) appears as compact bordered sections positioned within the top-right area of the main content. The reply input is a distinct, well-designed component at the bottom.

## Target Layout

```
┌────────────────────────────────────────────────────────┐
│ AppShell (two columns: sidebar + main)                 │
│ ┌──────────┬──────────────────────────────────────────┐│
│ │ Left     │  SessionPage (single canvas)            ││
│ │ Sidebar  │  ┌──────────────────────────────────┐   ││
│ │          │  │ Top bar: session title / breadcrumb│  ││
│ │ Sessions │  ├──────────────────┬───────────────┤   ││
│ │ list     │  │                  │ ┌───────────┐ │   ││
│ │          │  │  MessageThread   │ │ Status    │ │   ││
│ │          │  │  (scrollable)    │ │ widget    │ │   ││
│ │          │  │                  │ ├───────────┤ │   ││
│ │          │  │  - messages      │ │ Workspace │ │   ││
│ │          │  │  - tool calls    │ │ widget    │ │   ││
│ │          │  │  - approvals     │ └───────────┘ │   ││
│ │          │  │                  │               │   ││
│ │          │  ├──────────────────┴───────────────┤   ││
│ │          │  │  FollowUpInput (distinct card)   │   ││
│ │          │  │  ┌──────────────────────────────┐│   ││
│ │          │  │  │ Reply...          [model] [↑]││   ││
│ │          │  │  └──────────────────────────────┘│   ││
│ │          │  └──────────────────────────────────┘   ││
│ └──────────┴──────────────────────────────────────────┘│
└────────────────────────────────────────────────────────┘
```

The main content area is one surface. Metadata widgets are components positioned within it (top-right, sticky). The FollowUpInput is a distinct component pinned at the bottom. No separate panel. No panel chrome.

## Task Breakdown

### Phase 1: Remove ContextPanel Infrastructure (Console-only)

**Goal**: Eliminate the right sidebar from AppShell and clean up the slot mechanism.

**Files affected** (all in `client-apps/web/`):
- `src/components/layout/AppShell.tsx` — Remove `ContextPanelContainer` and `ContextPanelSlotProvider`
- `src/components/layout/ContextPanel.tsx` — Delete entirely (or gut)
- `src/components/layout/use-layout-state.tsx` — Remove `useContextPanelSlot`, `useContextPanelSlotContent`, `useContextPanelOpen`, and the `ContextPanelSlotProvider`
- `src/app/sessions/[id]/SessionPage.tsx` — Remove `useContextPanelSlot()` call, remove `useContextPanelOpen()`, remove the auto-open effect

**What stays**: `useSidebarOpen()` and the left sidebar infrastructure remain unchanged.

**SDK impact**: None. The ContextPanel and slot mechanism are entirely Console-specific.

### Phase 2: Decompose ExecutionDetails into Compact Widgets (SDK)

**Goal**: Break the monolithic `ExecutionDetails` component into small, independently usable widget components.

**Current `ExecutionDetails` sections**:
- StatusSection (phase badge, duration)
- ModelSection (provider, model name)
- TokensSection (input/output/total tokens)
- CostSection (estimated cost)
- ContextWindowSection (utilization bar)
- ResolvedContextSection (MCP servers, skills, env keys)
- WorkspaceSection (workspace entries)

**New SDK components** (in `@stigmer/react`):
- `ExecutionStatusWidget` — Phase badge + duration (compact, most important)
- `WorkspaceWidget` — Workspace entries (compact list)
- Keep `ExecutionDetails` as-is for backward compat but mark as composition of widgets

These are small bordered card components that can be placed anywhere. Styled with `--stgm-*` tokens, self-contained.

**SDK impact**: New exports added. No existing exports removed or changed. `ExecutionDetails` remains available.

### Phase 3: Redesign SessionPage Layout (Console)

**Goal**: Compose the new single-canvas session page.

**New layout structure** in `SessionPage.tsx`:
1. Main area is `position: relative` to allow sticky positioning of widgets
2. `MessageThread` fills the scrollable area (left portion, or full width on narrow screens)
3. Metadata widgets (`ExecutionStatusWidget`, `WorkspaceWidget`) are positioned top-right with `sticky top-0` so they stay visible while scrolling
4. `FollowUpInput` is pinned at the bottom
5. On narrow screens (< lg), widgets collapse above or below the thread

**FollowUpInput visual treatment**: Match the `SessionLauncher` style — `rounded-xl border border-border bg-card shadow-sm` container with clear visual identity. The component already has this inner styling; the outer wrapper just needs adjustment.

### Phase 4: Theme Token Alignment (SDK)

**Goal**: Ensure the unified background works across themes.

After removing the right sidebar, the main content area is the only surface. The sidebar tokens affect only the left sidebar. Consider:
- Reducing the dark mode `--stgm-sidebar` luminance gap (0.205 → closer to 0.145) so the left sidebar blends better
- This is a refinement, not a blocker

## Execution Order

1. Phase 1 first (remove ContextPanel) — this is the structural prerequisite
2. Phase 2 (create widgets) — these need to exist before Phase 3
3. Phase 3 (redesign SessionPage) — compose everything
4. Phase 4 (theme tuning) — polish

Phases 1 and 2 can be done in parallel since they touch different files.

## SDK Placement Analysis

| Component | Location | Why |
|-----------|----------|-----|
| `ExecutionStatusWidget` | `@stigmer/react` | Platform builders embedding execution views need status display |
| `WorkspaceWidget` | `@stigmer/react` | Platform builders may show workspace info alongside executions |
| `ExecutionDetails` | `@stigmer/react` (unchanged) | Backward compatible — still useful for sidebar-style layouts |
| `FollowUpInput` | `@stigmer/react` (visual tweak) | Already there, just needs styling alignment |
| ContextPanel removal | `client-apps/web` only | Console layout concern |
| SessionPage layout | `client-apps/web` only | Console page composition |

## Risks

1. **ContextPanel slot mechanism removal**: Other pages or future pages might use `useContextPanelSlot`. Need to verify no other consumers exist before removing.
2. **Responsive layout complexity**: Positioning metadata widgets top-right while keeping the conversation scrollable requires careful CSS. On narrow screens the widgets need to gracefully collapse.
3. **FollowUpInput SDK contract**: Changing the outer wrapper styling affects platform builders who embed it. The inner container styling should remain the visual anchor.

## Success Criteria

1. Right sidebar (ContextPanel) removed from AppShell — the page is two columns only
2. Session page renders status and workspace as compact top-right widgets within the main content area
3. FollowUpInput is a distinct, visible component at the bottom matching SessionLauncher style
4. Single background canvas — no visual blocks, no panel chrome
5. `ExecutionDetails` still available in `@stigmer/react` for backward compat
6. New widget components exported from `@stigmer/react` and usable independently

## Review Process

**What happens next**:
1. **You review this plan** — challenge anything that doesn't feel right
2. **Provide feedback** — layout decisions, widget selection, responsive behavior
3. **I'll revise** — create T01_2_revised_plan.md incorporating feedback
4. **You approve** — explicit approval to proceed
5. **Execution begins** — tracked in T01_3_execution.md
