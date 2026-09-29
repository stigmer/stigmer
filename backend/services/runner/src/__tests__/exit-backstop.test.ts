import { afterEach, describe, expect, it, vi } from "vitest";
import { EXIT_BACKSTOP_MS, armExitBackstop, describeResources } from "../exit-backstop.js";

/**
 * The exit backstop's contract (exit-backstop.ts): it never holds the loop,
 * it stays silent before its bound, and at the bound it names what is still
 * alive and exits 0, once. The real-process behaviour (a healthy runner
 * exits in milliseconds, a leaked handle is cut at the bound) is proven
 * against the built runner and by the execution conformance harness's
 * slow-exit line; these pin the logic.
 */

afterEach(() => {
  vi.useRealTimers();
});

function arm(overrides: { boundMs?: number; resources?: string[] } = {}) {
  const exit = vi.fn<(code: number) => void>();
  const log = vi.fn<(line: string) => void>();
  const timer = armExitBackstop({
    boundMs: overrides.boundMs,
    exit,
    log,
    activeResources: () => overrides.resources ?? ["TCPSocketWrap", "Timeout", "TCPSocketWrap"],
  });
  return { exit, log, timer };
}

describe("armExitBackstop", () => {
  it("does not hold the event loop", () => {
    const { timer } = arm();
    try {
      expect(timer.hasRef()).toBe(false);
    } finally {
      clearTimeout(timer);
    }
  });

  it("stays silent before the bound", () => {
    vi.useFakeTimers();
    const { exit, log } = arm();

    vi.advanceTimersByTime(EXIT_BACKSTOP_MS - 1);

    expect(exit).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("at the bound, names what is still alive and exits 0, once", () => {
    vi.useFakeTimers();
    const { exit, log } = arm();

    vi.advanceTimersByTime(EXIT_BACKSTOP_MS);
    vi.advanceTimersByTime(EXIT_BACKSTOP_MS);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toBe(
      `[runner] Process still alive ${EXIT_BACKSTOP_MS}ms after shutdown; forcing exit. ` +
        "Active resources: TCPSocketWrap×2, Timeout×1",
    );
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("honours an explicit bound", () => {
    vi.useFakeTimers();
    const { exit } = arm({ boundMs: 250 });

    vi.advanceTimersByTime(249);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("keeps the bound above the conformance harness's 2 s slow-exit line", () => {
    // Below it, the harness would stop reporting the very leaks this cuts.
    expect(EXIT_BACKSTOP_MS).toBeGreaterThan(2_000);
  });
});

describe("describeResources", () => {
  it("groups and sorts, so the same leak reads the same on every exit", () => {
    expect(describeResources(["Timeout", "TCPSocketWrap", "PipeWrap", "TCPSocketWrap"])).toBe(
      "PipeWrap×1, TCPSocketWrap×2, Timeout×1",
    );
  });

  it("says so when Node reports nothing", () => {
    expect(describeResources([])).toBe("none reported");
  });
});
