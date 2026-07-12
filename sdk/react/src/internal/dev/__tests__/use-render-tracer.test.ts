import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRenderTracer } from "../use-render-tracer";

describe("useRenderTracer", () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Perf logging is opt-in (off by default). Enable it via the browser
    // runtime flag so these behavioral assertions exercise the logging path.
    (globalThis as { __STIGMER_PERF__?: boolean }).__STIGMER_PERF__ = true;
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    delete (globalThis as { __STIGMER_PERF__?: boolean }).__STIGMER_PERF__;
    debugSpy.mockRestore();
  });

  it("logs on the first render", () => {
    renderHook(() => useRenderTracer("TestComponent", { foo: "bar" }));

    expect(debugSpy).toHaveBeenCalledTimes(1);
    const msg = debugSpy.mock.calls[0][0] as string;
    expect(msg).toContain("[stgm:perf:render]");
    expect(msg).toContain("TestComponent");
    expect(msg).toContain("render=#1");
  });

  it("samples output — skips intermediate renders, logs every 10th", () => {
    const { rerender } = renderHook(
      ({ count }) => useRenderTracer("Counter", { count }),
      { initialProps: { count: 0 } },
    );

    debugSpy.mockClear();

    // Renders 2-9: no output (sampled every 10th, first was #1)
    for (let i = 1; i < 9; i++) {
      rerender({ count: i });
    }
    expect(debugSpy).not.toHaveBeenCalled();

    // Render #10: should log
    rerender({ count: 9 });
    expect(debugSpy).toHaveBeenCalledTimes(1);
    const msg = debugSpy.mock.calls[0][0] as string;
    expect(msg).toContain("render=#10");
  });

  it("reports changed props on sampled renders", () => {
    const stableRef = {};
    const { rerender } = renderHook(
      ({ a, b }) => useRenderTracer("Diff", { a, b }),
      { initialProps: { a: stableRef as unknown, b: 1 as unknown } },
    );

    debugSpy.mockClear();

    // Drive to render #10 with only `b` changing each time
    for (let i = 1; i < 9; i++) {
      rerender({ a: stableRef, b: i + 1 });
    }

    // Render #10
    rerender({ a: stableRef, b: 10 });
    expect(debugSpy).toHaveBeenCalledTimes(1);

    const msg = debugSpy.mock.calls[0][0] as string;
    expect(msg).toContain("changed=[b]");
  });

  it("includes primitive prop values in output", () => {
    renderHook(() =>
      useRenderTracer("Props", { count: 42, active: true }),
    );

    const msg = debugSpy.mock.calls[0][0] as string;
    expect(msg).toContain("count=42");
    expect(msg).toContain("active=true");
  });
});
