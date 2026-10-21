/**
 * The liveness pump (`../liveness-pump.ts`): it says what the turn has open
 * when the turn starts and at every interval after the last send, a change
 * in what is open sends it on the streaming floor (once, however many events
 * fold meanwhile, and not at all for an event that changed nothing), a send
 * the chokepoint found busy is tried again on the floor, the first refusal
 * stops it for the turn with one log line, a send that throws is logged, and
 * `stop` waits for a send in flight and schedules nothing after.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LivenessPump, type LivenessSend } from "../liveness-pump.js";
import type { OperationsSnapshot } from "../open-operations.js";

const INTERVAL_MS = 30_000;
const FLOOR_MS = 500;

const NOTHING: OperationsSnapshot = { operations: [], awaitingModelMs: undefined };
const BUILD: OperationsSnapshot = { operations: [{ callId: "c1", name: "shell", openedAtMs: 0, ageMs: 1_000 }], awaitingModelMs: undefined };

function pumpOver(outcomes: LivenessSend[] = []) {
  let snapshot = NOTHING;
  const send = vi.fn(async (_: OperationsSnapshot): Promise<LivenessSend> => outcomes.shift() ?? "sent");
  const pump = new LivenessPump({ snapshot: () => snapshot, send, intervalMs: INTERVAL_MS, minGapMs: FLOOR_MS, runId: "aex_1" });
  return { pump, send, set: (next: OperationsSnapshot) => (snapshot = next) };
}

describe("LivenessPump", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("says so at the start and at every interval while nothing changes", async () => {
    const { pump, send } = pumpOver();
    pump.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2 * INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(4);
    await pump.stop();
  });

  it("sends a change once on the floor, and nothing for an event that changed nothing", async () => {
    const { pump, send, set } = pumpOver();
    pump.start();
    await vi.advanceTimersByTimeAsync(0);
    pump.note();
    await vi.advanceTimersByTimeAsync(FLOOR_MS);
    expect(send, "nothing changed").toHaveBeenCalledTimes(1);
    set(BUILD);
    pump.note();
    pump.note();
    await vi.advanceTimersByTimeAsync(FLOOR_MS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(BUILD);
    set({ ...BUILD, operations: [{ ...BUILD.operations[0]!, ageMs: 9_000 }] });
    pump.note();
    await vi.advanceTimersByTimeAsync(FLOOR_MS);
    expect(send, "an older age is not a change").toHaveBeenCalledTimes(2);
    set({ operations: [], awaitingModelMs: 10 });
    pump.note();
    await vi.advanceTimersByTimeAsync(FLOOR_MS);
    expect(send, "the turn now waits on its model").toHaveBeenCalledTimes(3);
    await pump.stop();
  });

  it("tries a busy send again on the floor", async () => {
    const { pump, send } = pumpOver(["busy", "busy"]);
    pump.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2 * FLOOR_MS);
    expect(send).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(FLOOR_MS);
    expect(send).toHaveBeenCalledTimes(3);
    await pump.stop();
  });

  it("stops for the turn on the first refusal, saying so once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { pump, send, set } = pumpOver(["refused"]);
      pump.start();
      await vi.advanceTimersByTimeAsync(0);
      set(BUILD);
      pump.note();
      await vi.advanceTimersByTimeAsync(3 * INTERVAL_MS);
      expect(send).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toMatch(/refused the liveness preview/);
      await pump.stop();
    } finally {
      warn.mockRestore();
    }
  });

  it("logs a send that throws and goes on at the interval", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { pump, send } = pumpOver();
      send.mockRejectedValueOnce(new Error("boom"));
      pump.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(String(warn.mock.calls[0]![0])).toMatch(/boom/);
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(send).toHaveBeenCalledTimes(2);
      await pump.stop();
    } finally {
      warn.mockRestore();
    }
  });

  it("waits for a send in flight on stop, and schedules nothing after", async () => {
    let release!: () => void;
    const { pump, send, set } = pumpOver();
    send.mockImplementationOnce(() => new Promise<LivenessSend>((resolve) => (release = () => resolve("sent"))));
    pump.start();
    let stopped = false;
    const stopping = pump.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    release();
    await stopping;
    set(BUILD);
    pump.note();
    pump.start();
    await vi.advanceTimersByTimeAsync(2 * INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
