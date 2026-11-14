// useIsNarrowerThan reads the element's own laid-out width: false until it is
// measured (and where there is no ResizeObserver), then whether each
// measurement is under the width, following the element as it resizes.

import { describe, it, expect, afterEach, vi } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import { useRef } from "react";
import { useIsNarrowerThan } from "../useIsNarrowerThan";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe({ width }: { readonly width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const narrow = useIsNarrowerThan(ref, width);
  return <div ref={ref} data-narrow={String(narrow)} />;
}

/** A ResizeObserver the test drives by hand: `resize(px)` reports a new width to every observer. */
function stubResizeObserver() {
  const callbacks: ResizeObserverCallback[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  return (px: number) =>
    act(() => {
      for (const callback of callbacks) callback([{ contentRect: { width: px } } as ResizeObserverEntry], {} as ResizeObserver);
    });
}

describe("useIsNarrowerThan", () => {
  it("is false where the browser has no ResizeObserver, so an unmeasured element draws wide", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { container } = render(<Probe width={640} />);
    expect(container.firstElementChild!.getAttribute("data-narrow")).toBe("false");
  });

  it("follows the element's width across the threshold, the threshold itself counting as wide", () => {
    const resize = stubResizeObserver();
    const { container } = render(<Probe width={640} />);
    const probe = container.firstElementChild!;
    expect(probe.getAttribute("data-narrow")).toBe("false");
    resize(390);
    expect(probe.getAttribute("data-narrow")).toBe("true");
    resize(640);
    expect(probe.getAttribute("data-narrow")).toBe("false");
    resize(639);
    expect(probe.getAttribute("data-narrow")).toBe("true");
  });
});
