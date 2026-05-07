# Compact Harness Selector with Inline Label

**Date**: May 7, 2026

## Summary

Redesigned the harness selector inside the ModelSelector popover to use a compact inline layout with "Harness" label on the left and a smaller dropdown on the right. The harness row now always renders — showing as disabled/grayed-out in follow-up sessions instead of being hidden entirely.

## Problem Statement

The harness dropdown in the model selector popover took up the full width of the popover (~320px), making it feel oversized relative to the short label it displayed (e.g., "Cursor"). In follow-up sessions, the harness was completely hidden, giving users no indication of which harness their session was using.

### Pain Points

- Full-width dropdown looked disproportionate for a short label value
- No visual indicator of the active harness in follow-up/locked sessions
- The control didn't match the compact, polished aesthetic of the rest of the UI

## Solution

Refactored the harness section to an inline flex layout and changed the conditional rendering to always show the row with appropriate disabled styling when locked.

## Implementation Details

Single file changed: `sdk/react/src/models/ModelSelector.tsx`

- Container uses `flex items-center justify-between` for horizontal label + button layout
- "Harness" label rendered as muted text on the left
- Button changed from `w-full` to `inline-flex` with minimal width (just label + chevron)
- Removed the `{!isHarnessLocked && ...}` conditional — section always renders
- Added `disabled` attribute and `opacity-50 cursor-not-allowed` when harness is locked
- Chevron hidden in locked state (no interaction possible)
- Listbox anchored with `right-3 top-full` to align beneath the compact button

## Benefits

- Visually compact — the dropdown no longer dominates the popover header
- Users always see which harness is active, even in follow-up sessions
- Consistent with the "label: value" pattern used elsewhere in the product

## Impact

Affects all users of the `ModelSelector` component (web app session launcher and follow-up composer). No API/props changes — purely visual refinement.

---

**Status**: ✅ Production Ready
