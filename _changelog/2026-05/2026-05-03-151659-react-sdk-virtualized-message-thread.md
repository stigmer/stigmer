# React SDK: Opt-In Virtualized MessageThread (T11)

**Date**: May 3, 2026

## Summary

Added opt-in virtualization to `MessageThread` via a new `virtualized` prop backed by `react-virtuoso`. When enabled, only visible thread items are rendered in the DOM, bounding DOM node count for long conversations (100+ messages). The non-virtualized path remains the default and is completely unchanged.

## Problem Statement

Long AI agent conversations generate large DOM trees — each message, tool call group, sub-agent section, approval card, and phase badge is a rendered element. After T02–T10 eliminated streaming flicker, navigation flash, and unnecessary re-renders, the remaining performance gap for long threads was raw DOM node count during scrolling and layout.

### Pain Points

- Threads with 100+ items keep all items in the DOM, causing slow paint and layout on mid-tier hardware
- Browser memory pressure grows linearly with conversation length
- Scroll performance degrades as the DOM tree grows

## Solution

Integrated `react-virtuoso` (MIT-licensed, standard `Virtuoso` component) as an optional peer dependency. Consumers opt in with `<MessageThread virtualized />`. The implementation:

- Shares the same `buildThreadItems` pipeline and `ThreadItemRenderer` component across both paths — no rendering logic duplication
- Uses `React.lazy` + `Suspense` for tree-shaking, so `react-virtuoso` is zero-cost when not used
- Delegates scroll-follow behavior to Virtuoso's `alignToBottom` + `followOutput` + `atBottomStateChange` APIs
- Preserves all accessibility attributes (`role="log"`, `aria-live="polite"`, `aria-relevant="additions"`) via a custom scroller component
- Reuses the existing `JumpToLatestButton` with Virtuoso's `VirtuosoHandle.scrollToIndex` for re-engagement

## Implementation Details

### Extracted `ThreadItemRenderer`

The inline `switch (item.kind)` block in `MessageThread` was extracted into a standalone `ThreadItemRenderer` component. Both the non-virtualized `items.map()` path and Virtuoso's `itemContent` callback use it, eliminating rendering logic duplication.

### `VirtualizedThread` (internal component)

New file `sdk/react/src/internal/VirtualizedThread.tsx` — wraps `Virtuoso` with chat-optimized configuration:

- `alignToBottom`: items pin to viewport bottom when content is shorter than the container
- `followOutput`: returns `"smooth"` when at bottom, `false` when disengaged
- `computeItemKey`: passes through stable semantic keys from `buildThreadItems`
- `atBottomThreshold: 80`: matches the non-virtualized path's 80px near-bottom tolerance
- `increaseViewportBy: { top: 200, bottom: 200 }`: overscan to reduce blank areas during fast scroll
- `components.Scroller`: custom `ScrollerWithA11y` forwarding `role="log"` and ARIA attributes
- Context providers (`FilePathContext`, `SandboxContext`) wrap the Virtuoso tree

### `NonVirtualizedThread` (internal component)

The original scroll-container rendering path was extracted into `NonVirtualizedThread`. This keeps `MessageThread` itself focused on shared logic (building items, computing context values) and the rendering path branch.

### Lazy Import

`VirtualizedThread` is imported via `React.lazy` and rendered inside `<Suspense fallback={null}>`. Consumers who never pass `virtualized={true}` never download `react-virtuoso`.

### Dependency Strategy

- `react-virtuoso ^4.0.0` added as **optional peer dependency** (MIT license)
- `react-virtuoso ^4.18.6` installed as dev dependency for development and testing
- No impact on consumers who don't use virtualization

## Benefits

- **Bounded DOM for long threads**: Only visible items + overscan rendered, regardless of conversation length
- **Zero-cost when unused**: Lazy import ensures `react-virtuoso` is not bundled for consumers who don't enable virtualization
- **No breaking changes**: `virtualized` defaults to `false`; all existing behavior preserved
- **Shared rendering code**: `ThreadItemRenderer` eliminates duplication between paths
- **Consistent UX**: Same auto-scroll, jump-to-latest, accessibility, and dev instrumentation in both modes

## Impact

- **SDK consumers**: Can opt into virtualization for long-conversation use cases with a single prop
- **Bundle size**: Zero impact when `virtualized` is not used; ~15KB gzipped when enabled (react-virtuoso)
- **Public API**: Additive only — `virtualized?: boolean` on `MessageThreadProps`
- **Test suite**: 15 new tests (4 ThreadItemRenderer, 2 non-virtualized regression, 9 virtualized behavior), total 439/439 passing

## Related Work

- T02: Streaming render instrumentation (dev hooks preserved in virtualized mode)
- T03: Stable semantic keys (passed through to Virtuoso via `computeItemKey`)
- T04: ConversationStore + structural sharing (unchanged, feeds both paths)
- T05: React.memo on leaf components (unchanged, benefits both paths)
- T10: Auto-scroll state machine (used by non-virtualized path; Virtuoso handles its own scroll-follow)

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
