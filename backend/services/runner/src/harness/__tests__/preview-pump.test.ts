/**
 * The preview pump (`../preview-pump.ts`): a delta schedules one flush a
 * floor interval later, however many deltas follow; a flush the chokepoint
 * refused because a write held the slot is tried again next interval, as is
 * output that arrived while a flush ran; nothing is scheduled once it is
 * stopped, and `stop` waits for a flush already sending.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PreviewPump } from "../preview-pump.js";

const FLOOR_MS = 500;

describe("PreviewPump", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends once per interval, however many lines a tool prints in it", async () => {
    let pending = false;
    const flush = vi.fn(async () => {
      pending = false;
      return true;
    });
    const pump = new PreviewPump({ pending: () => pending, flush, intervalMs: FLOOR_MS });

    for (let i = 0; i < 5; i++) {
      pending = true;
      pump.note();
    }
    await vi.advanceTimersByTimeAsync(FLOOR_MS - 1);
    expect(flush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10 * FLOOR_MS);
    expect(flush, "nothing waits, so nothing more is sent").toHaveBeenCalledTimes(1);
  });

  it("tries again next interval while a write holds the slot, until the output is sent", async () => {
    let pending = true;
    let busy = 2;
    const flush = vi.fn(async () => {
      if (busy > 0) {
        busy -= 1;
        return false;
      }
      pending = false;
      return true;
    });
    const pump = new PreviewPump({ pending: () => pending, flush, intervalMs: FLOOR_MS });

    pump.note();
    await vi.advanceTimersByTimeAsync(3 * FLOOR_MS);
    expect(flush).toHaveBeenCalledTimes(3);
    expect(pending).toBe(false);
    await vi.advanceTimersByTimeAsync(3 * FLOOR_MS);
    expect(flush).toHaveBeenCalledTimes(3);
  });

  it("sends output that arrived during a flush on the next interval", async () => {
    let pending = true;
    let release: () => void = () => {};
    const flush = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => {
            resolve(true);
          };
        }),
    );
    const pump = new PreviewPump({ pending: () => pending, flush, intervalMs: FLOOR_MS });

    pump.note();
    await vi.advanceTimersByTimeAsync(FLOOR_MS);
    expect(flush).toHaveBeenCalledTimes(1);
    pending = true;
    pump.note();
    await vi.advanceTimersByTimeAsync(FLOOR_MS);
    expect(flush, "one flush at a time").toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(FLOOR_MS);
    expect(flush).toHaveBeenCalledTimes(2);
    pending = false;
    release();
    await vi.advanceTimersByTimeAsync(FLOOR_MS);
  });

  it("schedules nothing once stopped, and stop waits for a flush already sending", async () => {
    let finished = false;
    let release: () => void = () => {};
    const flush = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => {
            finished = true;
            resolve(true);
          };
        }),
    );
    const pump = new PreviewPump({ pending: () => true, flush, intervalMs: FLOOR_MS });

    pump.note();
    await vi.advanceTimersByTimeAsync(FLOOR_MS);
    const stopped = pump.stop();
    let done = false;
    void stopped.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done, "stop waits while the flush sends").toBe(false);
    release();
    await stopped;
    expect(finished).toBe(true);

    pump.note();
    await vi.advanceTimersByTimeAsync(10 * FLOOR_MS);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("logs a flush that throws and goes on", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let pending = true;
    const flush = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("pipe closed"))
      .mockImplementation(async () => {
        pending = false;
        return true;
      });
    const pump = new PreviewPump({ pending: () => pending, flush, intervalMs: FLOOR_MS });

    pump.note();
    await vi.advanceTimersByTimeAsync(2 * FLOOR_MS);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("pipe closed"));
    expect(flush).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
