import { describe, expect, it, vi } from "vitest";
import { type Logger } from "../../logger.js";
import { type SupervisedTarget, TemporalSupervisor } from "./supervisor.js";

const silentLog: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeTarget(overrides: Partial<SupervisedTarget> = {}): SupervisedTarget & {
  isRunning: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
} {
  return {
    isRunning: vi.fn(async () => true),
    start: vi.fn(async () => {}),
    ...overrides,
  } as never;
}

function makeSupervisor(target: SupervisedTarget) {
  return new TemporalSupervisor(target, { backoffMs: 0, sleep: async () => {}, log: silentLog });
}

describe("TemporalSupervisor.checkHealthAndRestart", () => {
  it("does nothing while the target is healthy", async () => {
    const target = makeTarget({ isRunning: vi.fn(async () => true) });
    await makeSupervisor(target).checkHealthAndRestart();
    expect(target.start).not.toHaveBeenCalled();
  });

  it("restarts when the target is unhealthy", async () => {
    const target = makeTarget({ isRunning: vi.fn(async () => false) });
    await makeSupervisor(target).checkHealthAndRestart();
    expect(target.start).toHaveBeenCalledTimes(1);
  });

  it("swallows a restart failure (retried on the next tick)", async () => {
    const target = makeTarget({
      isRunning: vi.fn(async () => false),
      start: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    await expect(makeSupervisor(target).checkHealthAndRestart()).resolves.toBeUndefined();
    expect(target.start).toHaveBeenCalledTimes(1);
  });

  it("does not restart if stopped during the backoff", async () => {
    const target = makeTarget({ isRunning: vi.fn(async () => false) });
    const supervisor = new TemporalSupervisor(target, {
      backoffMs: 0,
      // Stop the supervisor while it is "sleeping" through the backoff.
      sleep: async () => {
        supervisor.stop();
      },
      log: silentLog,
    });
    await supervisor.checkHealthAndRestart();
    expect(target.start).not.toHaveBeenCalled();
  });
});

describe("TemporalSupervisor start/stop", () => {
  it("schedules ticks and stops cleanly", async () => {
    vi.useFakeTimers();
    try {
      const target = makeTarget({ isRunning: vi.fn(async () => true) });
      const supervisor = new TemporalSupervisor(target, { intervalMs: 1000, log: silentLog });
      supervisor.start();
      await vi.advanceTimersByTimeAsync(1000);
      expect(target.isRunning).toHaveBeenCalledTimes(1);
      supervisor.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(target.isRunning).toHaveBeenCalledTimes(1); // no further ticks after stop
    } finally {
      vi.useRealTimers();
    }
  });
});
