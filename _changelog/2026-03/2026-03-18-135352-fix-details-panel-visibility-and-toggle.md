# Fix Details Panel Visibility and Toggle Placement

**Date**: March 18, 2026

## Summary

Fixed three layout issues in the Console's three-column shell: the Details panel appearing empty on the home page, a floating toggle button overlapping the main content area, and inconsistent panel open/close affordances. All changes are scoped to `client-apps/web` — no SDK packages were modified.

## Problem Statement

The Console layout had three UX issues that degraded the experience and violated the minimalist design heuristic:

### Pain Points

- The Details (context) panel remained visible on the home page after navigating away from a session, showing an empty "Details" header with just an X button — wasted screen space and confusing to users
- A `PanelRight` toggle button was absolutely positioned at `right-2 top-2` inside the main content area of the session page, floating over the message thread — misplaced and visually disruptive
- The panel had two close affordances (the floating toggle and the X in the panel header) creating redundancy, while the left sidebar had a clean single-pattern approach

## Solution

Extracted the context panel container into a `ContextPanelContainer` child component within the `ContextPanelSlotProvider` tree, enabling it to read slot content and condition visibility on both user intent (`isOpen`) and content availability (`slotContent != null`). Added a mirrored re-open button pattern matching the left sidebar's affordance design.

## Implementation Details

- **`AppShell.tsx`**: Extracted the context panel `<div>` into a `ContextPanelContainer` component. This component lives inside `ContextPanelSlotProvider`, so it can call `useContextPanelSlotContent()` — something `AppShell` itself cannot do since it renders above the provider. Panel width collapses to 0 when `!isOpen || !hasContent`. Added a `PanelRight` re-open button at `fixed top-2 right-2`, shown only when the panel is closed but has content (mirrors the left sidebar's `PanelLeft` at `fixed top-2 left-2`).
- **`SessionPage.tsx`**: Removed the floating `PanelRight` toggle button and its `PanelRight` import. Removed the `relative` positioning class from the container div since no absolutely-positioned children remain.

## Benefits

- Home page no longer shows an empty Details panel after visiting a session
- The `isOpen` state is preserved across navigation so the panel re-opens automatically when returning to a session with content
- Consistent toggle pattern: left sidebar and right panel both use a fixed-position icon button to reopen when collapsed, and an in-header button to close
- Cleaner session page layout without floating UI overlapping content

## Impact

- **Users**: Cleaner home page, more intuitive panel toggle behavior
- **Maintainers**: `ContextPanelContainer` encapsulates all panel visibility logic in one place
- **SDK boundary**: No changes to `@stigmer/react` or `@stigmer/theme` — all fixes are Console app-shell concerns

## Related Work

- Part of the `feat/session-first-web-ux` branch
- Builds on the sidebar recents and session conversation work

---

**Status**: ✅ Production Ready
