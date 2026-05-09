# ResourceWorkbench Creation Slot (Phase 3 T04-A)

**Date**: May 9, 2026

## Summary

Added `headerAction` and `emptyAction` props to `ResourceWorkbench`, making the workbench self-contained with creation entry points. The "Add X" buttons that previously floated in page-level headers now live inside the workbench toolbar and first-use empty state, fixing a Fitts's Law proximity violation and making the SDK component embeddable without external CTA plumbing.

## Problem Statement

The `ResourceWorkbench` component had no slot for a primary creation action. The "Add Agent" / "Add Skill" / "Add MCP Server" buttons lived in each Console page's header, disconnected from the workbench itself.

### Pain Points

- First-use empty state showed "No agents yet" with no CTA — the create button was far above in the page header (proximity violation)
- Platform builders embedding `ResourceWorkbench` in their own apps had to separately implement a create button outside the workbench
- The workbench was not self-contained — it could browse resources but couldn't offer a creation path

## Solution

Added two optional `ReactNode` slot props to `ResourceWorkbench`:
- `headerAction` — renders right-aligned in the toolbar after the view switcher (always visible)
- `emptyAction` — renders as the CTA in the first-use empty state (visible when collection is empty and no filters are active)

Enhanced `EmptyState` with a `children?: ReactNode` prop for flexible action slot content (non-breaking — existing `action` prop still works).

## Implementation Details

- **`EmptyState`** (`sdk/react/src/empty-state/`): Added `children?: ReactNode` to `EmptyStateProps`. When `children` is provided, it renders in the action area and takes precedence over the `action` button prop.
- **`ResourceWorkbench`** (`sdk/react/src/resource-workbench/`): Added `headerAction` and `emptyAction` props. `headerAction` renders as the last element in the toolbar flex row. `emptyAction` is passed as `children` to `EmptyState` for the `first-use` variant only.
- **Console list pages** (`client-apps/web/src/domain/library/`): All three pages (Agent, Skill, MCP Server) refactored to pass primary-styled `<Link>` elements as `headerAction` and `emptyAction`. Page-level header simplified to just title + subtitle.

## Benefits

- Creation entry point is now co-located with the empty state — Fitts's Law satisfied
- Workbench is fully self-contained for SDK consumers — no external CTA needed
- Buttons still route to the existing draft session flow (functional, not dead-end)
- Non-breaking: both new props are optional, existing consumers unaffected

## Impact

- **SDK consumers** (`@stigmer/react`): Two new optional props on `ResourceWorkbench`, one new optional prop on `EmptyState`
- **Console users**: "Create" button is more discoverable, especially for first-time users seeing an empty collection
- **Future phases**: T04-B/C/D creation wizards will be one-line route changes in the Console pages

## Related Work

- Phase 3 plan: `_projects/2026-05/20260508.02.resource-views-ux-overhaul/tasks/T04_0_plan.md`
- Phases 0-2 built the workbench foundations that T04-A extends

---

**Status**: ✅ Production Ready
**Timeline**: Single session
