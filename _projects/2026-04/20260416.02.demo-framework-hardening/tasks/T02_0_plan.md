# Task T02: Resize-Aware Scroll Recovery

**Created**: 2026-04-16
**Status**: RESOLVED BY T01
**Type**: Bug Fix
**Depends on**: T01

## Problem

`useStepInteractions` fires `scroll-to` once via `setTimeout` and never re-evaluates. If the container resizes after the scroll action fires (viewport change, orientation flip), the scroll position becomes stale. Meanwhile, `Cursor.tsx` has a `ResizeObserver` that recomputes cursor position on resize — creating an inconsistency where the cursor moves to the right place but the content is scrolled to the wrong position.

## Proposed Fix

Add a `ResizeObserver` to `useStepInteractions` that tracks the most recent `scroll-to` action per step. When the container resizes, re-trigger `scrollTargetIntoView` for the active scroll target.

### Implementation

1. Track the most recently fired `scroll-to` target in a ref
2. Add a `ResizeObserver` on `containerRef` (debounced, matching Cursor's 100ms debounce)
3. On resize, if there is an active scroll target, re-run `scrollTargetIntoView`
4. Clear the active scroll target on step change
5. Skip in video export mode (fixed composition size)

### Key file

`site/src/components/docs/demos/engine/useStepInteractions.ts`

## Resolution

T01's fixed virtual viewport eliminates the root cause: the internal
layout dimensions never change on resize — only the CSS zoom changes.
Scroll positions within the canonical layout remain valid regardless
of zoom. The ResizeObserver in `Cursor.tsx` continues to work because
layout-space coordinates are stable. No additional scroll recovery
logic is needed.
