import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { useRevealLine, type RevealTarget } from "../useRevealLine";
import { prefersReducedMotion } from "../motion-preference";

// Mock the motion utility directly: it caches at module scope, so driving it
// through `matchMedia` would leak state across cases. Mocking gives each test a
// deterministic reduced-motion answer.
vi.mock("../motion-preference", () => ({
  prefersReducedMotion: vi.fn(() => false),
}));

// A tiny harness that renders addressable line rows and drives the hook, so we
// exercise the real `[data-line]` query + scroll effect against a real DOM.
function LineView({
  reveal,
  lineCount = 5,
}: {
  readonly reveal: RevealTarget | undefined;
  readonly lineCount?: number;
}) {
  const { containerRef, isRevealed } = useRevealLine<HTMLDivElement>(reveal);
  return (
    <div ref={containerRef}>
      {Array.from({ length: lineCount }, (_, i) => {
        const line = i + 1;
        return (
          <span key={line} data-line={line} data-revealed={isRevealed(line)}>
            line {line}
          </span>
        );
      })}
    </div>
  );
}

describe("useRevealLine", () => {
  let scrollSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.mocked(prefersReducedMotion).mockReturnValue(false);
    // happy-dom has no real scrollIntoView — stub it to assert calls + options.
    scrollSpy = vi.fn();
    Element.prototype.scrollIntoView =
      scrollSpy as unknown as typeof Element.prototype.scrollIntoView;
  });

  afterEach(() => {
    cleanup();
  });

  it("scrolls the target line into view on mount", () => {
    render(<LineView reveal={{ line: 3, nonce: 1 }} />);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
  });

  it("re-scrolls when the nonce changes, even for the same line", () => {
    const { rerender } = render(<LineView reveal={{ line: 3, nonce: 1 }} />);
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    rerender(<LineView reveal={{ line: 3, nonce: 2 }} />);
    expect(scrollSpy).toHaveBeenCalledTimes(2);
  });

  it("does not re-scroll when the nonce is unchanged", () => {
    const { rerender } = render(<LineView reveal={{ line: 3, nonce: 7 }} />);
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    // Same nonce, different (irrelevant) prop → no additional scroll.
    rerender(<LineView reveal={{ line: 3, nonce: 7 }} lineCount={6} />);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the target line is out of range", () => {
    render(<LineView reveal={{ line: 99, nonce: 1 }} lineCount={5} />);
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("is a no-op when there is no reveal target", () => {
    render(<LineView reveal={undefined} />);
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("uses instant scroll under prefers-reduced-motion", () => {
    vi.mocked(prefersReducedMotion).mockReturnValue(true);
    render(<LineView reveal={{ line: 2, nonce: 1 }} />);
    expect(scrollSpy).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  });

  it("reports the revealed line via isRevealed", () => {
    const { container } = render(<LineView reveal={{ line: 4, nonce: 1 }} />);
    const revealed = container.querySelector('[data-revealed="true"]');
    expect(revealed?.getAttribute("data-line")).toBe("4");
    expect(container.querySelectorAll('[data-revealed="true"]')).toHaveLength(1);
  });
});
