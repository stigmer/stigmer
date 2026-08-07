// Scroll-behavior regression suite for useAutoScroll (channel-conversations
// F-09). Runs in a real Chromium via `vitest.a11y.config.ts` — the defect
// lives in IntersectionObserver/ResizeObserver timing against real layout,
// which happy-dom cannot evaluate (there, every scrollHeight is 0 and the
// observers are mocks).
//
// The production shape under test: a chat thread whose items arrive ASYNC
// after mount, so the content wrapper renders inside a loading branch and
// does not exist on the first render. The shipped bug: the hook attached
// its ResizeObserver only at mount, so a late-mounting wrapper was never
// observed — every conversation opened at the OLDEST message with "Jump to
// latest" showing, and nothing ever scrolled the view again.
//
// Layout is driven by inline styles (not the shipped stylesheet): this
// suite pins the hook's observer mechanics, not CSS — the real component's
// rendering is covered by ConversationTimelineView.layout.test.tsx.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { useAutoScroll, type UseAutoScrollReturn } from "../useAutoScroll";

const VIEWPORT_PX = 240;
const ITEM_PX = 48;

let latest: UseAutoScrollReturn;

/**
 * The production thread shape: scroller and sentinel always mounted, the
 * content wrapper only once items exist (the loading branch renders a
 * skeleton instead).
 */
function AsyncThread({ items }: { readonly items: readonly string[] }) {
  const hook = useAutoScroll();
  latest = hook;
  return (
    <div
      ref={hook.scrollRef}
      data-testid="scroller"
      style={{ height: VIEWPORT_PX, overflowY: "auto" }}
    >
      {items.length === 0 ? (
        <div data-testid="skeleton" style={{ height: 100 }} />
      ) : (
        <div ref={hook.contentRef} data-testid="content">
          {items.map((text) => (
            <div key={text} style={{ height: ITEM_PX }}>
              {text}
            </div>
          ))}
        </div>
      )}
      <div ref={hook.sentinelRef} aria-hidden="true" />
    </div>
  );
}

const messages = (count: number, offset = 0) =>
  Array.from({ length: count }, (_, i) => `message ${i + offset}`);

function scroller(): HTMLElement {
  return document.querySelector('[data-testid="scroller"]') as HTMLElement;
}

const isPinnedToBottom = (el: HTMLElement) =>
  Math.abs(el.scrollTop - (el.scrollHeight - el.clientHeight)) <= 1;

/** Wait out rAF-batched scroll writes and async observer callbacks. */
async function settled(assertion: () => void): Promise<void> {
  await vi.waitFor(assertion, { timeout: 2000, interval: 20 });
}

// Determinism note: every case fills content AFTER mount on purpose. With
// a late-mounting wrapper the mount-time scroll write is a no-op (the
// skeleton does not overflow), so the bottom pin can only come from the
// ResizeObserver pathway — "pinned" therefore PROVES the observer's
// initial delivery and its rAF write have both run, and no pinning work
// is pending when a case then simulates the reader's scroll. (Headless
// Chromium delivers initial observations on its own schedule; waiting a
// frame count instead was measured flaky.)

afterEach(() => cleanup());

describe("useAutoScroll under real layout (F-09)", () => {
  it("pins to the newest content when items arrive after mount", async () => {
    const { rerender } = render(<AsyncThread items={[]} />);

    // The async first fill: 30 × 48px inside a 240px viewport.
    rerender(<AsyncThread items={messages(30)} />);

    await settled(() => {
      expect(isPinnedToBottom(scroller()), "view must open at the newest message").toBe(true);
      expect(latest.isFollowing).toBe(true);
    });
  });

  it("keeps following growth that lands after an async first fill", async () => {
    const { rerender } = render(<AsyncThread items={[]} />);
    rerender(<AsyncThread items={messages(30)} />);
    await settled(() => expect(isPinnedToBottom(scroller())).toBe(true));

    // A new message lands (a poll tick): the pinned view must follow it.
    rerender(<AsyncThread items={messages(31)} />);

    await settled(() => {
      expect(isPinnedToBottom(scroller())).toBe(true);
      expect(latest.isFollowing).toBe(true);
    });
  });

  it("leaves a reader who scrolled up alone, and jumpToLatest recovers", async () => {
    const { rerender } = render(<AsyncThread items={[]} />);
    rerender(<AsyncThread items={messages(30)} />);
    await settled(() => {
      expect(isPinnedToBottom(scroller())).toBe(true);
      // Follow-STATE quiescence, not just position: the pin's own IO
      // deliveries (a transient not-visible mid-pin, then visible)
      // must have landed before the reader scrolls up — otherwise the
      // disengage wait below can pass vacuously on the transient FALSE
      // while a queued pre-scroll TRUE re-arms follow behind it, and
      // the growth step yanks the reader (measured ~1-in-40 headless).
      expect(latest.isFollowing).toBe(true);
    });

    // The reader scrolls up to read history — follow disengages.
    scroller().scrollTop = 0;
    await settled(() => expect(latest.isFollowing).toBe(false));

    // Growth while disengaged (an incoming message, or the reader's own
    // send arriving via refetch): the view must NOT move under them.
    // This is the measured scroll-on-send posture — see the F-09 record.
    rerender(<AsyncThread items={messages(31)} />);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(scroller().scrollTop).toBe(0);
    expect(latest.isFollowing).toBe(false);

    // The recovery affordance: jumpToLatest re-pins and re-engages.
    latest.jumpToLatest();
    await settled(() => {
      expect(isPinnedToBottom(scroller())).toBe(true);
      expect(latest.isFollowing).toBe(true);
    });
  });
});
