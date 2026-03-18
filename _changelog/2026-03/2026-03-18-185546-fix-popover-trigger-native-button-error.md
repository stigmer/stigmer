# Fix Popover.Trigger Native Button Error in SessionComposer

**Date**: March 18, 2026

## Summary

Fixed a Base UI console error in `SessionComposer` where `Popover.Trigger` expected a native `<button>` but received a `<span>`. Restructured the private `ContextPopover` and `ContextTriggerButton` helpers to eliminate the double-wrapping pattern, producing a single semantically correct `<button>` in the DOM.

## Problem Statement

The `ContextPopover` component used Base UI's `Popover.Trigger` with a `render` prop that wrapped the trigger content in a `<span>`. The trigger content itself (`ContextTriggerButton`) rendered its own `<button>`.

### Pain Points

- Base UI's `Popover.Trigger` defaults to `nativeButton: true`, expecting the rendered element to be a native `<button>` -- a `<span>` violates that expectation, producing a console error on every render
- The resulting DOM was `<span (popover behavior)> <button (visual)> </button> </span>` -- nested interactive elements that confuse screen readers and break keyboard navigation expectations
- The `<span>` trigger lacked native button semantics: no implicit `role="button"`, no keyboard activation via Enter/Space without ARIA workarounds

## Solution

Eliminated the double-wrapping by merging `ContextTriggerButton`'s content and styling directly into `Popover.Trigger`'s default native `<button>`. Changed `ContextPopover` from accepting a pre-rendered `trigger: ReactNode` to accepting structured props (`icon`, `label`, `count`) and rendering them as children of `Popover.Trigger`. Removed the now-redundant `ContextTriggerButton` component.

## Implementation Details

All changes confined to `sdk/react/src/composer/SessionComposer.tsx`:

- **`ContextPopover`**: Changed props from `{ trigger: ReactNode }` to `{ icon: ReactNode; label: string; count: number }`. Removed the `render` prop from `Popover.Trigger` and instead applied the trigger styling via `className` directly on `Popover.Trigger`, with icon/label/count as children.
- **`ContextTriggerButton`**: Deleted entirely -- its styling and content rendering are now inlined into `ContextPopover`'s `Popover.Trigger`.
- **Call sites** (Workspace, MCP, Skills): Updated from passing `trigger={<ContextTriggerButton ... />}` to passing `icon`, `label`, `count` as direct props to `ContextPopover`.
- Fixed a minor indentation inconsistency on the `Popover.Positioner` line.

## Benefits

- Eliminates the Base UI console error across all three context popover triggers
- Produces valid, accessible HTML -- a single native `<button>` per trigger with correct keyboard and screen reader semantics
- Simpler component tree with one fewer indirection layer

## Impact

- **SDK consumers**: No impact -- `SessionComposerProps` (the public API) is unchanged
- **Accessibility**: Corrects a semantic violation (non-interactive element wrapping an interactive one)
- **DX**: Cleaner internal structure for future maintenance of the composer toolbar

---

**Status**: Production Ready
