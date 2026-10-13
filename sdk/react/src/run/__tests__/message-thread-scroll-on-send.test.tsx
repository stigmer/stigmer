// Scroll-on-send wiring pins for MessageThread: the send moment is the
// optimistic message's empty→present transition, and it must pin the thread
// exactly once — default-ON, opt-out via `scrollOnSend={false}` (a
// deliberate exception to opt-in defaults). The REAL scroll mechanics (pin
// + follow re-engagement under real layout) are pinned in
// `internal/__tests__/useAutoScroll.layout.browser.test.tsx`; this file
// pins the surface's signal derivation through a spied `jumpToLatest`, with
// the real `usePinToLatestOnSignal` connecting them.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { samples } from "../../test/samples";

const jumpToLatestSpy = vi.fn();

// The fake replaces only the scroll machine (browser observers happy-dom
// lacks); `usePinToLatestOnSignal` stays REAL, so these tests exercise the
// actual signal contract between MessageThread and its render paths.
vi.mock("../../internal/useAutoScroll", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../internal/useAutoScroll")>();
  return {
    ...original,
    useAutoScroll: () => ({
      scrollRef: { current: null },
      sentinelRef: { current: null },
      contentRef: () => {},
      isFollowing: true,
      jumpToLatest: jumpToLatestSpy,
    }),
  };
});

import { MessageThread } from "../MessageThread";

afterEach(() => {
  cleanup();
  jumpToLatestSpy.mockClear();
});

/** One finished turn of the conversation, folded from its events. */
const earlierTurns = () => [samples.turn({ runId: "run_1", message: "earlier turn" })];

describe("MessageThread — scroll-on-send", () => {
  it("pins the thread exactly once when the optimistic message appears (default-on)", () => {
    const turns = earlierTurns();
    const { rerender } = render(
      <MessageThread turns={turns} pendingUserMessage={null} />,
    );
    expect(jumpToLatestSpy).not.toHaveBeenCalled();

    // The send: the composer sets the optimistic message.
    rerender(
      <MessageThread turns={turns} pendingUserMessage="do the thing" />,
    );
    expect(jumpToLatestSpy).toHaveBeenCalledTimes(1);

    // Re-renders while the message stays pending must not re-pin — the
    // reader may have scrolled up again to read history mid-turn.
    rerender(
      <MessageThread turns={turns} pendingUserMessage="do the thing" />,
    );
    expect(jumpToLatestSpy).toHaveBeenCalledTimes(1);
  });

  it("pins again on the NEXT send after the pending message clears", () => {
    const turns = earlierTurns();
    const { rerender } = render(
      <MessageThread turns={turns} pendingUserMessage={null} />,
    );

    rerender(
      <MessageThread turns={turns} pendingUserMessage="first send" />,
    );
    rerender(<MessageThread turns={turns} pendingUserMessage={null} />);
    rerender(
      <MessageThread turns={turns} pendingUserMessage="second send" />,
    );

    expect(jumpToLatestSpy).toHaveBeenCalledTimes(2);
  });

  it("does not re-pin on a failed send's retry — pending stays present throughout, and the reader was already brought to it", () => {
    const turns = earlierTurns();
    const { rerender } = render(
      <MessageThread turns={turns} pendingUserMessage={null} />,
    );

    rerender(
      <MessageThread turns={turns} pendingUserMessage="flaky send" />,
    );
    rerender(
      <MessageThread
        turns={turns}
        pendingUserMessage="flaky send"
        pendingMessageFailed
        onRetrySend={() => {}}
      />,
    );
    rerender(
      <MessageThread turns={turns} pendingUserMessage="flaky send" />,
    );

    expect(jumpToLatestSpy).toHaveBeenCalledTimes(1);
  });

  it("never pins with scrollOnSend={false} — the opt-out preserves today's leave-the-reader-alone behavior", () => {
    const turns = earlierTurns();
    const { rerender } = render(
      <MessageThread
        turns={turns}
        pendingUserMessage={null}
        scrollOnSend={false}
      />,
    );

    rerender(
      <MessageThread
        turns={turns}
        pendingUserMessage="do the thing"
        scrollOnSend={false}
      />,
    );

    expect(jumpToLatestSpy).not.toHaveBeenCalled();
  });
});
