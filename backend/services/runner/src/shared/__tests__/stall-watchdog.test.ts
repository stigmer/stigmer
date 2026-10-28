/**
 * The stall watchdog's timer: it fires once after a window with no activity,
 * activity resets it, it stays quiet while the runtime says the turn is busy
 * (`held`), and it runs the runtime's per-poll check (`onTick`) on its own
 * cadence. Pinned on fake timers, so a window of minutes runs in no time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startStallWatchdog,
  StallTimeoutError,
  formatStallFailure,
  STALL_ERROR_PREFIX,
} from "../stall-watchdog.js";

describe("startStallWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("fires onStall once after the idle window elapses with no activity", () => {
    const onStall = vi.fn();
    const wd = startStallWatchdog(60_000, onStall);

    // Just before the window: not yet fired.
    vi.advanceTimersByTime(59_000);
    expect(onStall).not.toHaveBeenCalled();

    // Cross the window: fires exactly once.
    vi.advanceTimersByTime(2_000);
    expect(onStall).toHaveBeenCalledTimes(1);
    expect(onStall.mock.calls[0][0]).toBeGreaterThanOrEqual(60_000);

    // It self-disarms — no further fires even as time marches on.
    vi.advanceTimersByTime(120_000);
    expect(onStall).toHaveBeenCalledTimes(1);

    wd.stop();
  });

  it("recordActivity resets the idle timer so progress keeps it alive", () => {
    const onStall = vi.fn();
    const wd = startStallWatchdog(60_000, onStall);

    // Report progress every 40s for a while: the window never elapses.
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(40_000);
      wd.recordActivity();
    }
    expect(onStall).not.toHaveBeenCalled();

    // Now go quiet past the window. Detection has up to one poll interval
    // (stallMs/4, capped 15s) of slop because ticks fire on absolute
    // boundaries, so advance stallMs + a full tick to guarantee a fire.
    vi.advanceTimersByTime(76_000);
    expect(onStall).toHaveBeenCalledTimes(1);

    wd.stop();
  });

  it("stop() disarms the watchdog so onStall never fires", () => {
    const onStall = vi.fn();
    const wd = startStallWatchdog(60_000, onStall);

    wd.stop();
    vi.advanceTimersByTime(600_000);
    expect(onStall).not.toHaveBeenCalled();
  });

  it("is robust to stop() called after firing (idempotent)", () => {
    const onStall = vi.fn();
    const wd = startStallWatchdog(30_000, onStall);

    vi.advanceTimersByTime(31_000);
    expect(onStall).toHaveBeenCalledTimes(1);

    expect(() => wd.stop()).not.toThrow();
    vi.advanceTimersByTime(60_000);
    expect(onStall).toHaveBeenCalledTimes(1);
  });
});

describe("startStallWatchdog with the runtime's options", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not fire while held, however long, and counts the window again from the last held poll", () => {
    const onStall = vi.fn();
    let busy = true;
    const wd = startStallWatchdog(60_000, onStall, { held: () => busy });

    vi.advanceTimersByTime(10 * 60_000);
    expect(onStall).not.toHaveBeenCalled();

    busy = false;
    vi.advanceTimersByTime(45_000);
    expect(onStall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(onStall).toHaveBeenCalledTimes(1);
    wd.stop();
  });

  it("runs onTick on every poll before the idle check, and onTick's stop wins over a stall", () => {
    const onStall = vi.fn();
    const ticks: number[] = [];
    let wd: ReturnType<typeof startStallWatchdog> | undefined;
    wd = startStallWatchdog(60_000, onStall, {
      onTick: () => {
        ticks.push(Date.now());
        if (ticks.length === 4) wd?.stop();
      },
    });

    vi.advanceTimersByTime(15_000 * 3);
    expect(ticks).toHaveLength(3);
    vi.advanceTimersByTime(15_000 * 4);
    expect(ticks, "a stopped watchdog runs no more ticks").toHaveLength(4);
    expect(onStall, "the fourth poll reached the window, but onTick stopped it first").not.toHaveBeenCalled();
  });
});

describe("StallTimeoutError", () => {
  it("builds a readable message from the idle duration", () => {
    const err = new StallTimeoutError(120_000);
    expect(err.name).toBe("StallTimeoutError");
    expect(err.stalledMs).toBe(120_000);
    expect(err.message).toContain("120s");
  });

  it("appends an optional detail", () => {
    const err = new StallTimeoutError(90_000, "last tool: browser_capture");
    expect(err.message).toContain("90s");
    expect(err.message).toContain("last tool: browser_capture");
  });
});

describe("formatStallFailure", () => {
  it("prefixes the recognizable tag and appends actionable guidance", () => {
    const msg = formatStallFailure(new StallTimeoutError(180_000, "last tool: browser_capture"));
    expect(msg.startsWith(STALL_ERROR_PREFIX)).toBe(true);
    expect(msg).toContain("180s");
    expect(msg).toContain("last tool: browser_capture");
    expect(msg).toContain("Retry or resume.");
  });
});
