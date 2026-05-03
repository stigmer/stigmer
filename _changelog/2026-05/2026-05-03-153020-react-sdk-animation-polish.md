# React SDK Animation & Polish (T12) — Streaming UX Project Complete

**Date**: May 3, 2026

## Summary

Implemented the final phase (T12) of the React SDK streaming UX overhaul: CSS entry animations for thread items, a chat-shaped thread skeleton, smooth JumpToLatestButton transitions, and global `prefers-reduced-motion` support. With all 11 phases (T02–T12) now shipped, the @stigmer/react SDK delivers a flicker-free, production-quality streaming conversation experience with 453 passing tests.

## Problem Statement

After T02–T11 eliminated structural rendering issues (flicker, stale data, scroll jank, over-rendering), the thread lacked visual polish: new messages appeared instantly without entry transitions, the loading skeleton was generic (not chat-shaped), the JumpToLatestButton popped in/out without animation, and there was no `prefers-reduced-motion` support for accessibility.

### Pain Points

- New thread items appeared abruptly — no visual indication of content arriving
- Session loading showed generic pulse bars instead of chat-shaped placeholders
- JumpToLatestButton mount/unmount caused a visual pop
- No accessibility support for users who prefer reduced motion
- SDK had no animation infrastructure (no keyframes, no motion tokens)

## Solution

Pure CSS animation layer with a lightweight React wrapper component, designed to work correctly across both the non-virtualized and virtualized rendering paths.

## Implementation Details

### Animation Infrastructure (`styles.css`)
- `@keyframes stgm-fade-in-up`: subtle 6px upward slide + opacity fade
- `--stgm-motion-duration` (150ms) and `--stgm-motion-easing` CSS custom properties for consumer-level tuning
- `.stgm-thread-item-enter` utility class inside `@layer stgm`

### ThreadItemWrapper (new internal component)
- Applies animation class on mount, removes on `animationEnd` (or 300ms fallback timeout)
- After animation completes, renders children directly with no wrapper div overhead
- Non-virtualized path: always animate (items mount exactly once)
- Virtualized path: tail-only guard (`index >= items.length - 2`) prevents react-virtuoso recycled mounts from triggering spurious animations

### ThreadSkeleton (new exported component)
- Chat-shaped pulse skeleton: 2 human message bubbles + 2 AI response line groups
- Matches existing skeleton visual language (`animate-pulse`, `bg-muted-subtle`, `aria-busy`)
- Integrated into web app's `SessionSkeleton`

### JumpToLatestButton Transitions
- Always-mounted with `visible` prop controlling opacity/translate-y/pointer-events
- CSS transitions use `--stgm-motion-duration` for timing
- Proper `aria-hidden` and `tabIndex` toggling

### prefers-reduced-motion
- Global `@media` block: animation-duration and transition-duration set to 0.01ms (not 0ms — ensures `animationend`/`transitionend` JS callbacks still fire)
- Kills all SDK motion: entry animations, `animate-pulse`, `animate-spin`, transitions

## Files Changed

| File | Change |
|------|--------|
| `sdk/react/src/styles.css` | Animation keyframes, custom properties, reduced-motion block |
| `sdk/react/src/internal/ThreadItemWrapper.tsx` | **New** — entry animation wrapper |
| `sdk/react/src/internal/JumpToLatestButton.tsx` | Rewritten with `visible` prop + transitions |
| `sdk/react/src/internal/VirtualizedThread.tsx` | Wrapper + button wiring |
| `sdk/react/src/execution/MessageThread.tsx` | Wrapper + button wiring |
| `sdk/react/src/execution/ThreadSkeleton.tsx` | **New** — chat-shaped skeleton |
| `sdk/react/src/execution/index.ts` | ThreadSkeleton export |
| `sdk/react/src/index.ts` | ThreadSkeleton export |
| `client-apps/web/src/domain/session/SessionPage.tsx` | Uses ThreadSkeleton |
| `sdk/react/src/internal/__tests__/thread-animation.test.tsx` | **New** — 8 tests |
| `sdk/react/src/execution/__tests__/thread-skeleton.test.tsx` | **New** — 5 tests |
| `sdk/react/src/execution/__tests__/virtualized-thread.test.tsx` | 1 new test |

## Benefits

- **Perceived quality**: Thread items slide in smoothly — the experience feels intentional and polished
- **Accessible by default**: `prefers-reduced-motion` kills all motion globally with zero consumer effort
- **Chat-shaped skeleton**: Loading state looks like the content it's loading, reducing perceived wait time
- **Smooth button transitions**: JumpToLatestButton fades in/out instead of popping
- **Zero runtime dependencies**: Pure CSS animations, no Framer Motion or animation library
- **Backward compatible**: No public API breaks; `ThreadSkeleton` is additive

## Impact

This completes the 11-phase React SDK streaming UX project. The full scope delivered:

1. Dev instrumentation (T02)
2. Stable semantic keys (T03)
3. Structural-sharing ConversationStore (T04)
4. Row-level React.memo memoization (T05)
5. Stream controller FSM with rAF coalescing (T06)
6. Streamdown streaming markdown (T07)
7. FetchCache cross-mount caching (T08)
8. Composer isolation via React.memo (T09)
9. IO-driven auto-scroll state machine (T10)
10. Opt-in react-virtuoso virtualization (T11)
11. CSS entry animations and polish (T12)

Test suite: 453 passing tests across 40 files.

## Related Work

- [React SDK Streaming Render Instrumentation](2026-05-03-102015-react-sdk-streaming-render-instrumentation.md) (T02)
- [React SDK Stable Thread Keys](2026-05-03-104710-react-sdk-stable-thread-keys.md) (T03)
- [React SDK Conversation Store](2026-05-03-115249-react-sdk-conversation-store-structural-sharing.md) (T04)
- [React SDK Row-Level Memoization](2026-05-03-122454-react-sdk-row-level-memoization.md) (T05)
- [React SDK Stream Controller](2026-05-03-124923-react-sdk-stream-controller-state-machine.md) (T06)
- [React SDK Streaming Markdown](2026-05-03-132118-react-sdk-streaming-markdown.md) (T07)
- [React SDK Fetch Cache](2026-05-03-140208-react-sdk-fetch-cache.md) (T08)
- [React SDK Composer Isolation](2026-05-03-142248-react-sdk-composer-isolation.md) (T09)
- [React SDK Auto-Scroll State Machine](2026-05-03-144353-react-sdk-auto-scroll-state-machine.md) (T10)
- [React SDK Virtualized MessageThread](2026-05-03-151659-react-sdk-virtualized-message-thread.md) (T11)

---

**Status**: ✅ Production Ready
**Timeline**: 11 sessions, single day
