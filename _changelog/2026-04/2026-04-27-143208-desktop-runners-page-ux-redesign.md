# Desktop Runners Page UX Redesign

**Date**: April 27, 2026

## Summary

Redesigned the desktop Runners page to fix a broken layout when viewing runner logs, replaced the side-panel log viewer with a bottom panel (matching VS Code/Docker Desktop conventions), enhanced runner rows with a two-line card layout, and enriched the log viewer header with runner context metadata. The SDK `RunnerListPanel` was also updated, so the web console benefits from the improved runner rows.

## Problem Statement

The Runners page had several UX issues that degraded the monitoring experience for developers managing local agent runners.

### Pain Points

- **Broken log panel layout**: Clicking "View logs" created a 50/50 horizontal split constrained to 70vh, squeezing the runner list into the left half and the log output into the right half, with wasted space below
- **Side-panel logs violated developer expectations**: Log output conventionally appears at the bottom of the screen (VS Code, Chrome DevTools, Docker Desktop), not in a right-side panel — log lines are wide, making horizontal space more valuable than vertical
- **Runner row was a horizontal data dump**: Name, badges, hostname, os/arch, version, execution count, and last heartbeat were crammed into a single line, hidden behind responsive breakpoints at smaller widths
- **Log viewer had no runner context**: Only showed runner name and "Live" indicator — user had to mentally hold the runner's phase, execution count, and connection info while reading logs

## Solution

Applied a full layout redesign based on Nielsen's heuristics (Visibility of System Status, Recognition Over Recall, Aesthetic and Minimalist Design) and Jakob's Law (developer tool conventions):

1. **Full-height vertical flex layout** with a collapsible bottom log panel
2. **Two-line runner row cards** with structured visual hierarchy
3. **Enriched log viewer header** with phase, execution count, and connection metadata
4. **Drag-to-resize handle** with localStorage persistence for the log panel ratio

## Implementation Details

### Desktop Layout (RunnersPage.tsx)

- Removed the `max-w-4xl mx-auto` wrapper from `routes.tsx` — page now fills the full viewport height
- Replaced `flex max-h-[70vh]` horizontal split with a `flex flex-col h-full` vertical layout
- Bottom log panel uses `flex: 0 0 {ratio}%` sizing with a pointer-event-based drag handle
- Panel ratio persisted to `localStorage` (`stigmer:runner-log-panel-ratio`, default 40%, clamped 15–75%)
- Escape key closes the log panel (Nielsen #3: User Control and Freedom)
- Clicking the same runner's log icon toggles the panel closed
- Selected runner row gets a `bg-primary-subtle border-primary` highlight

### Two-Line Runner Row (both desktop and SDK)

- Line 1: Runner name (bold, truncated) + Local/System badges + phase indicator (dot + label)
- Line 2: Hostname, os/arch, execution count, and last heartbeat joined by centered dots (`\u00b7`)
- Changed from `items-center` to `items-start` for proper two-line alignment
- Icon and action buttons use `mt-0.5` / `pt-0.5` for top-alignment with the first text line

### Log Viewer Header (RunnerLogViewer.tsx)

- Now accepts the full `Runner` object alongside `runnerName`
- Header displays: runner name, phase pill (color-coded), execution count, os/arch, runner version, and Live indicator
- Smart auto-scroll: sticks to bottom when user is at the bottom, stops tracking when they scroll up

### SDK Impact

The `RunnerListPanel` in `@stigmer/react` was updated with the same two-line row layout. This means the web console's runner list (which uses `RunnerListPanel`) also gets the improved presentation. No breaking API changes — `RunnerListPanelProps` is unchanged.

## Benefits

- Log output gets full horizontal width, matching developer expectations from VS Code/Docker Desktop
- Runner metadata is scannable without horizontal scrolling or hidden breakpoints
- Log viewer preserves runner context, eliminating cognitive load
- Resize ratio persists across navigations — users set their preferred split once
- Theme token compliance: all visual properties flow through `--stgm-*` tokens, zero opacity modifiers

## Impact

- **Desktop app**: Runners page is now fully usable for log monitoring workflows
- **SDK (`@stigmer/react`)**: `RunnerListPanel` runner rows are more informative and scannable
- **Web console**: Inherits the improved runner row layout via `RunnerListPanel`
- **Files changed**: 4 (RunnersPage.tsx, RunnerLogViewer.tsx, routes.tsx, RunnerListPanel.tsx)
- **Lines**: +370, −193

## Related Work

- Part of the `20260426.01.desktop-web-ux-parity` project
- Follows the SDK-first architecture (DD-001) and theme token compliance (DD-005) standards
- Builds on Session 14's centralized content wrapper and Session 11's Runners top-level navigation promotion

---

**Status**: ✅ Production Ready
