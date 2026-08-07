import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, screen, cleanup } from "@testing-library/react";
import React from "react";
import { useAutoScroll, type UseAutoScrollReturn } from "../useAutoScroll";

// ---------------------------------------------------------------------------
// Test harness — renders actual DOM elements so refs get populated
// ---------------------------------------------------------------------------

let latestResult: UseAutoScrollReturn;

function Harness() {
  const result = useAutoScroll();
  latestResult = result;
  return (
    <div ref={result.scrollRef} data-testid="scroller">
      <div ref={result.contentRef} data-testid="content">
        <p>Hello</p>
      </div>
      <div ref={result.sentinelRef} data-testid="sentinel" />
    </div>
  );
}

/**
 * The conversation-timeline shape (channel-conversations F-09): the content
 * wrapper legitimately sits inside a loading branch, so it does NOT exist on
 * the first render — the hook must attach its ResizeObserver whenever the
 * wrapper appears, not only at mount.
 */
function LateContentHarness({ showContent }: { readonly showContent: boolean }) {
  const result = useAutoScroll();
  latestResult = result;
  return (
    <div ref={result.scrollRef} data-testid="scroller">
      {showContent ? (
        <div ref={result.contentRef} data-testid="content">
          <p>Hello</p>
        </div>
      ) : (
        <div data-testid="skeleton" />
      )}
      <div ref={result.sentinelRef} data-testid="sentinel" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Observer mocks
// ---------------------------------------------------------------------------

type IOCallback = IntersectionObserverCallback;
type ROCallback = ResizeObserverCallback;

let ioCallback: IOCallback;
let ioDisconnect: ReturnType<typeof vi.fn>;
let ioObserve: ReturnType<typeof vi.fn>;

let roCallback: ROCallback;
let roDisconnect: ReturnType<typeof vi.fn>;
let roObserve: ReturnType<typeof vi.fn>;

beforeEach(() => {
  ioDisconnect = vi.fn();
  ioObserve = vi.fn();
  roDisconnect = vi.fn();
  roObserve = vi.fn();

  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn((cb: IOCallback) => {
      ioCallback = cb;
      return {
        observe: ioObserve,
        unobserve: vi.fn(),
        disconnect: ioDisconnect,
        takeRecords: vi.fn(() => []),
        root: null,
        rootMargin: "",
        thresholds: [0],
      };
    }),
  );

  vi.stubGlobal(
    "ResizeObserver",
    vi.fn((cb: ROCallback) => {
      roCallback = cb;
      return {
        observe: roObserve,
        unobserve: vi.fn(),
        disconnect: roDisconnect,
      };
    }),
  );

  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: FrameRequestCallback) => {
      cb(performance.now());
      return 1;
    }),
  );

  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fireIO(isIntersecting: boolean) {
  act(() => {
    ioCallback(
      [{ isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
}

function fireRO() {
  act(() => {
    roCallback([], {} as ResizeObserver);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useAutoScroll", () => {
  it("starts in following state", () => {
    render(<Harness />);
    expect(latestResult.isFollowing).toBe(true);
  });

  it("observes sentinel with IntersectionObserver on mount", () => {
    render(<Harness />);
    expect(ioObserve).toHaveBeenCalledWith(screen.getByTestId("sentinel"));
  });

  it("observes content with ResizeObserver on mount", () => {
    render(<Harness />);
    expect(roObserve).toHaveBeenCalledWith(screen.getByTestId("content"));
  });

  it("observes content that mounts after the first render (F-09: loading-branch consumers)", () => {
    const { rerender } = render(<LateContentHarness showContent={false} />);
    expect(roObserve).not.toHaveBeenCalled();

    // The async first fill: the skeleton gives way to real content.
    rerender(<LateContentHarness showContent />);
    expect(roObserve).toHaveBeenCalledWith(screen.getByTestId("content"));
  });

  it("disconnects and re-observes across content unmount/remount round-trips", () => {
    const { rerender } = render(<LateContentHarness showContent />);
    expect(roObserve).toHaveBeenCalledTimes(1);

    // Back to a loading state (e.g. an identity switch resets the data
    // hook): the observer must let go of the dead node…
    rerender(<LateContentHarness showContent={false} />);
    expect(roDisconnect).toHaveBeenCalled();

    // …and adopt the replacement when content returns.
    rerender(<LateContentHarness showContent />);
    expect(roObserve).toHaveBeenCalledTimes(2);
    expect(roObserve).toHaveBeenLastCalledWith(screen.getByTestId("content"));
  });

  it("configures IO with 80px bottom root margin", () => {
    render(<Harness />);
    const IOConstructor = vi.mocked(IntersectionObserver);
    const options = IOConstructor.mock.calls[0]?.[1];
    expect(options?.rootMargin).toBe("0px 0px 80px 0px");
  });

  it("configures IO with scroll container as root", () => {
    render(<Harness />);
    const IOConstructor = vi.mocked(IntersectionObserver);
    const options = IOConstructor.mock.calls[0]?.[1];
    expect(options?.root).toBe(screen.getByTestId("scroller"));
  });

  it("disengages when sentinel exits viewport", () => {
    render(<Harness />);
    fireIO(false);
    expect(latestResult.isFollowing).toBe(false);
  });

  it("re-engages when sentinel enters viewport", () => {
    render(<Harness />);
    fireIO(false);
    expect(latestResult.isFollowing).toBe(false);

    fireIO(true);
    expect(latestResult.isFollowing).toBe(true);
  });

  it("jumpToLatest re-engages follow mode", () => {
    render(<Harness />);
    fireIO(false);
    expect(latestResult.isFollowing).toBe(false);

    act(() => {
      latestResult.jumpToLatest();
    });

    expect(latestResult.isFollowing).toBe(true);
  });

  it("jumpToLatest sets scrollTop to scrollHeight", () => {
    render(<Harness />);
    fireIO(false);

    const scroller = screen.getByTestId("scroller");
    Object.defineProperty(scroller, "scrollHeight", {
      value: 1000,
      configurable: true,
    });

    act(() => {
      latestResult.jumpToLatest();
    });

    expect(scroller.scrollTop).toBe(1000);
  });

  it("scrolls via rAF on content resize while following", () => {
    render(<Harness />);
    fireIO(true);

    const scroller = screen.getByTestId("scroller");
    Object.defineProperty(scroller, "scrollHeight", {
      value: 500,
      configurable: true,
    });

    fireRO();

    expect(requestAnimationFrame).toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(500);
  });

  it("does not scroll on content resize while disengaged", () => {
    render(<Harness />);
    fireIO(false);

    const scroller = screen.getByTestId("scroller");
    Object.defineProperty(scroller, "scrollHeight", {
      value: 500,
      configurable: true,
    });

    vi.mocked(requestAnimationFrame).mockClear();

    fireRO();

    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("cancels pending rAF before scheduling a new one", () => {
    render(<Harness />);
    fireIO(true);

    fireRO();
    fireRO();

    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it("disconnects IO on unmount", () => {
    const { unmount } = render(<Harness />);
    unmount();
    expect(ioDisconnect).toHaveBeenCalled();
  });

  it("disconnects RO on unmount", () => {
    const { unmount } = render(<Harness />);
    unmount();
    expect(roDisconnect).toHaveBeenCalled();
  });

  it("cancels pending rAF on unmount", () => {
    const { unmount } = render(<Harness />);
    fireIO(true);
    fireRO();

    vi.mocked(cancelAnimationFrame).mockClear();
    unmount();

    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it("scrolls to bottom on mount without error", () => {
    // The hook sets scrollTop = scrollHeight in the IO setup effect.
    // In jsdom both values are 0, so scrollTop stays 0. The important
    // thing is that the code path executes without error; real scroll
    // behavior is validated by integration tests.
    render(<Harness />);
    expect(screen.getByTestId("scroller").scrollTop).toBe(0);
  });
});
