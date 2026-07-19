import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, screen, cleanup } from "@testing-library/react";
import React from "react";
import { useInViewport, type UseInViewportReturn } from "../useInViewport";

// ---------------------------------------------------------------------------
// Test harness — renders a real element so the ref gets populated
// ---------------------------------------------------------------------------

let latestResult: UseInViewportReturn;

function Harness() {
  const result = useInViewport();
  latestResult = result;
  return <div ref={result.ref} data-testid="target" />;
}

// ---------------------------------------------------------------------------
// Observer mock (the useAutoScroll.test pattern)
// ---------------------------------------------------------------------------

type IOCallback = IntersectionObserverCallback;

let ioCallback: IOCallback;
let ioDisconnect: ReturnType<typeof vi.fn>;
let ioObserve: ReturnType<typeof vi.fn>;

beforeEach(() => {
  ioDisconnect = vi.fn();
  ioObserve = vi.fn();

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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fireIO(isIntersecting: boolean) {
  act(() => {
    ioCallback(
      [{ isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useInViewport", () => {
  it("starts not-visible until the observer's first callback", () => {
    render(<Harness />);
    expect(latestResult.isVisible).toBe(false);
  });

  it("observes the target element on mount", () => {
    render(<Harness />);
    expect(ioObserve).toHaveBeenCalledWith(screen.getByTestId("target"));
  });

  it("uses the top-level viewport as root with the pre-warm margin", () => {
    render(<Harness />);
    const IOConstructor = vi.mocked(IntersectionObserver);
    const options = IOConstructor.mock.calls[0]?.[1];
    expect(options?.root).toBeNull();
    expect(options?.rootMargin).toBe("200px 0px 200px 0px");
  });

  it("flips visible on enter and back on leave", () => {
    render(<Harness />);

    fireIO(true);
    expect(latestResult.isVisible).toBe(true);

    fireIO(false);
    expect(latestResult.isVisible).toBe(false);
  });

  it("reads the LATEST entry when a batch carries several", () => {
    render(<Harness />);
    act(() => {
      ioCallback(
        [
          { isIntersecting: true } as IntersectionObserverEntry,
          { isIntersecting: false } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });
    expect(latestResult.isVisible).toBe(false);
  });

  it("disconnects the observer on unmount", () => {
    const { unmount } = render(<Harness />);
    unmount();
    expect(ioDisconnect).toHaveBeenCalled();
  });
});
