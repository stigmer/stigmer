# Popover Content Overflow Fix — Scroll Constraints and Extracted Scroll-Shadow Utilities

**Date**: March 20, 2026

## Summary

Fixed unbounded content overflow in all popover-hosted SDK components by adding scroll constraints with consistent scroll-shadow affordances. Extracted the duplicated scroll-shadow pattern from three pickers into a reusable `useScrollShadows` hook and `ScrollFade` component, then applied the pattern to five additional components that previously had no overflow handling.

## Problem Statement

When a Stigmer agent requires many environment variables, or when a user selects many MCP servers/skills, the popover content grows beyond the viewport with no scrollbar. The `ContextPopover` wrapper used `overflow-hidden` with no `max-height`, silently clipping content — users could not reach form fields, submit buttons, or selected items below the fold.

### Pain Points

- **AgentEnvForm**: An agent with 10+ env vars made the "Save" button unreachable — fields were clipped with no way to scroll
- **OneTimeSecretsInput**: Adding many secret entries pushed the "Add variable" button off-screen
- **McpServerPicker / SkillPicker**: Selecting many items caused the "Selected" section to grow unbounded, pushing the search input out of view
- **WorkspaceEditor**: Many workspace entries pushed the source buttons below the fold
- **ContextPopover**: No viewport-proportional safety net meant any of the above could be clipped by the browser viewport

Additionally, the three existing pickers (`AgentPicker`, `McpServerPicker`, `SkillPicker`) each duplicated ~30 lines of identical scroll-shadow state management logic (useState, useCallback, useEffect, scroll listeners, gradient overlays).

## Solution

Two-level fix: extract the shared scroll-shadow pattern into reusable internal utilities, then apply scroll constraints systematically to every component that can grow inside a popover.

## Implementation Details

### New internal utilities (`sdk/react/src/internal/`)

- **`useScrollShadows`** — Hook that tracks scroll position via a passive scroll listener + ResizeObserver. Returns `{ scrollRef, canScrollUp, canScrollDown }`. The ResizeObserver ensures shadows update when content is added/removed, not just when the user scrolls.
- **`ScrollFade`** — Tiny presentational component rendering a gradient overlay (`pointer-events-none absolute`) that signals hidden content above or below. Uses `var(--color-popover)` for the gradient to blend with the popover background.

Both are `@internal` — not exported from the package barrel. They serve the SDK's own components.

### Refactored components (pure refactor, no behavior change)

- `AgentPicker`, `McpServerPicker`, `SkillPicker` — replaced ~30 lines of duplicated scroll-shadow boilerplate per component with ~5-8 lines using the new hook.

### New scroll constraints added

| Component | Section | Constraint | Rationale |
|-----------|---------|------------|-----------|
| `AgentEnvForm` | Fields | `max-h-64` (256px) | Shows ~4-5 field groups; scrolls for 6+ |
| `OneTimeSecretsInput` | Entries | `max-h-64` (256px) | Shows ~3 entries; scrolls for 4+ |
| `McpServerPicker` | Selected | `max-h-28` (112px) | Shows ~3-4 items; keeps search visible |
| `SkillPicker` | Selected | `max-h-28` (112px) | Same as MCP |
| `WorkspaceEditor` | Entry list | `max-h-28` (112px) | Shows ~3 entries; keeps source buttons visible |
| `ContextPopover` | Popup | `max-h-[80vh]` | Viewport safety net |

In all cases, headers, action buttons, and footers remain pinned outside the scrollable region.

## Benefits

- **Users can now reach all form fields and buttons** regardless of how many env vars, secrets, or selections exist
- **Consistent scroll affordance** — gradient shadows signal hidden content above/below, matching the established pattern from picker result lists
- **Net code reduction** — 312 insertions vs 286 deletions despite adding scroll handling to 5 new regions, thanks to eliminating ~90 lines of duplicated boilerplate
- **Maintainability** — scroll-shadow behavior is defined once in `useScrollShadows`; changes propagate to all 8 consumers automatically

## Impact

- **Direct users**: Forms with many env vars (like the `agent-creator` screenshot) are now fully usable
- **Platform builders**: SDK components handle overflow gracefully regardless of the container they're placed in — popovers, dialogs, sidebars, or inline on a page
- **No API changes**: Zero new props, no breaking changes to any exported types

## Related Work

- Agent picker and personal environment flow (secrets form was the original trigger)
- Secrets flow hardening (SecretFlowErrorGuide error handling)

---

**Status**: ✅ Production Ready
**Scope**: 9 files (2 new, 7 modified) across `@stigmer/react`
