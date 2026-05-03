# React SDK: Auto-Scroll State Machine (T10)

**Date**: May 3, 2026

## Summary

Replaced the naive scroll-to-bottom logic in `MessageThread` with a principled two-state auto-scroll state machine using `IntersectionObserver`, `ResizeObserver`, and `requestAnimationFrame`-batched scroll writes. Added a "Jump to latest" floating button for re-engaging follow mode after the user scrolls up.

## Problem Statement

The previous auto-scroll implementation in `MessageThread` had five deficiencies that degraded the streaming conversation experience:

### Pain Points

- **Fired only on `items` array changes** — during streaming, content height grows continuously as Streamdown appends tokens, but the `items` reference stays stable (same thread items, mutated content inside). Auto-scroll stopped working mid-stream once the items array settled.
- **Synchronous `scrollTop` write** — triggered forced synchronous layout on every scroll update, misaligned with the browser's paint cycle.
- **`onScroll` event + arithmetic** — relied on throttled scroll events and manual near-bottom calculation. Missed edge cases: programmatic scrolls, window resize, and layout shifts from tool panel expansion.
- **No "Jump to latest" affordance** — when the user scrolled up to read earlier messages, the only way to re-engage was to manually scroll to the exact bottom.
- **No awareness of height changes** — tool panel expand/collapse, code block rendering, and image loading could push the user away from the bottom without the near-bottom ref updating.

## Solution

A self-contained `useAutoScroll` hook that owns all scroll state and DOM observation, driven by a two-state machine:

- **Following** — sentinel is visible; content growth triggers rAF-batched scroll-to-bottom.
- **Disengaged** — user scrolled away; no automatic scrolling; "Jump to latest" button appears.

State transitions are entirely driven by an `IntersectionObserver` on a zero-height sentinel element at the bottom of the scroll container, eliminating main-thread scroll arithmetic.

## Implementation Details

### `useAutoScroll` hook (`sdk/react/src/internal/useAutoScroll.ts`)

- `IntersectionObserver` on a bottom sentinel with `rootMargin: "0px 0px 80px 0px"` — matches the existing 80px near-bottom tolerance.
- `ResizeObserver` on a content wrapper `<div>` — detects height growth from streaming tokens, new messages, tool panel expansion, or any DOM change.
- `requestAnimationFrame` batching — coalesces multiple resize events per frame into a single scroll write. Previous rAF is cancelled before scheduling a new one.
- `jumpToLatest()` — scrolls to bottom and eagerly sets state to Following; IO callback confirms when sentinel becomes visible.
- Scrolls to bottom on mount to establish the initial position before observing.
- Both observers are disconnected on unmount; pending rAF is cancelled.

### `JumpToLatestButton` (`sdk/react/src/internal/JumpToLatestButton.tsx`)

- Compact pill button with inline chevron-down SVG icon (no icon library dependency).
- Absolutely positioned at the bottom-center of the scroll container's positioning wrapper.
- Uses `bg-card` with `shadow-md` and `border-border` — consistent with theme tokens, no opacity modifiers.
- Accessible: `aria-label="Jump to latest"`, keyboard-focusable with visible ring.

### `MessageThread` changes (`sdk/react/src/execution/MessageThread.tsx`)

- Removed: `scrollRef`, `isNearBottomRef`, `handleScroll`, `AUTO_SCROLL_THRESHOLD_PX`, `onScroll` handler, `useEffect([items])` scroll block.
- Removed unused imports: `useRef`, `useEffect`.
- Added positioning wrapper `<div>` with `relative min-h-0` (receives the consumer's `className` for flex layout).
- Scroll container now uses `h-full`, `overflow-y-auto`, `[overflow-anchor:none]` to prevent browser anchor fighting.
- Content wrapped in `<div ref={contentRef}>` for ResizeObserver targeting.
- Sentinel `<div ref={sentinelRef} aria-hidden="true" />` rendered as the last child of the scroll container.
- `JumpToLatestButton` conditionally rendered when `!isFollowing`.

### Key Design Decisions

- **Content-agnostic state machine**: Does not need `isStreaming` or any streaming awareness. The sentinel/IO pattern handles all content growth — streaming tokens, new messages, tool panel expansion — uniformly.
- **IO over scroll events**: `IntersectionObserver` is passive (no main-thread cost), fires on resize/layout shifts automatically, handles programmatic scrolls, and eliminates the need for manual near-bottom arithmetic.
- **Wrapper div for positioning**: The `JumpToLatestButton` needs to float over the scroll viewport. CSS `position: sticky` doesn't work for elements at the bottom of scrollable content when the user scrolls up. A `position: relative` wrapper with `position: absolute` button is the correct pattern.
- **T11-compatible**: When virtualization (react-virtuoso) is introduced in T11, its built-in `followOutput`/`atBottomStateChange` APIs will replace `useAutoScroll`. The hook is internal, so the swap has zero public API impact.
- **No new public exports**: `useAutoScroll`, `JumpToLatestButton` are internal. `MessageThreadProps` is unchanged. Fully backward compatible.

## Benefits

- **Auto-scroll works continuously during streaming** — ResizeObserver detects every content height change, not just `items` array mutations.
- **Zero main-thread scroll arithmetic** — IO is passive; no `onScroll` event handler computing distances.
- **rAF-aligned scroll writes** — no forced synchronous layout; scroll updates align with the browser's paint cycle.
- **Tool panel expansion handled automatically** — ResizeObserver fires on any content height change.
- **"Jump to latest" button** — users can re-engage follow mode with a single click after scrolling up.
- **Clean separation** — all scroll logic lives in the hook; `MessageThread` only consumes the return value.

## Impact

- **SDK consumers**: No API changes. `MessageThreadProps` is unchanged. The wrapper div adds one DOM level, but `className` is correctly forwarded to the wrapper.
- **Platform users**: Auto-scroll now works reliably during streaming. "Jump to latest" button provides a clear affordance for re-engaging after scrolling up.
- **T11 compatibility**: The hook is internal and designed to be swapped out when react-virtuoso takes over scroll management.

## Testing

- 16 new unit tests in `sdk/react/src/internal/__tests__/useAutoScroll.test.tsx`
- Tests cover: initial state, observer wiring, IO root margin configuration, state transitions (disengage/re-engage), `jumpToLatest` behavior, rAF scroll writes (following vs disengaged), rAF cancellation, observer cleanup on unmount
- Full suite: 424/424 pass (16 new + 408 existing), typecheck clean, lint clean

## Related Work

- **T02–T09**: Previous phases of the streaming UX project (instrumentation, keys, structural sharing, memoization, stream controller, Streamdown, FetchCache, composer isolation)
- **T11 (next)**: Virtualization with react-virtuoso — will replace `useAutoScroll` with virtuoso's native scroll management
- **T12 (upcoming)**: Animation and polish — CSS entry transitions, skeletons, `content-visibility`, `@starting-style`

---

**Status**: Production Ready
**Timeline**: 1 session (~30 minutes)
