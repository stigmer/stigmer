/**
 * Proves the session follow's state machine (../stream-controller.ts):
 * `connecting` on start, `streaming` on the first frame (and back from
 * `reconnecting`), frames folded at once but published at most once per
 * scheduled flush, `reconnecting` and `error` keeping the last fold, reset
 * cancelling a pending publish, and the two watchdogs — the connect-timeout
 * that fires only while still connecting, and the slow-stall hint that
 * restarts on every frame and stands down on a drop or an error.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { StreamSessionEventsResponse } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { samples } from "../../test/samples";
import { StreamController, type StreamControllerSink } from "../stream-controller";
import type { StreamState } from "../store/conversation-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestSink(changes = true) {
  const sink = {
    frames: [] as StreamSessionEventsResponse[],
    publishes: 0,
    states: [] as StreamState[],
    connectTimeouts: 0,
    slow: [] as boolean[],
    changes,
    applyFrame(frame: StreamSessionEventsResponse): boolean {
      sink.frames.push(frame);
      return sink.changes;
    },
    publish(): void {
      sink.publishes += 1;
    },
    setStreamState(state: StreamState): void {
      sink.states.push(state);
    },
    onConnectTimeout(): void {
      sink.connectTimeouts += 1;
    },
    setSlow(value: boolean): void {
      sink.slow.push(value);
    },
  } satisfies StreamControllerSink & Record<string, unknown>;
  return sink;
}

/** A manual clock: records armed timers and fires them by duration. */
function createManualTimers() {
  const timers = new Map<number, { cb: () => void; ms: number }>();
  let nextId = 1;
  return {
    setTimer(cb: () => void, ms: number): number {
      const id = nextId++;
      timers.set(id, { cb, ms });
      return id;
    },
    clearTimer(id: number): void {
      timers.delete(id);
    },
    fire(ms: number): void {
      for (const [id, t] of [...timers]) {
        if (t.ms === ms) {
          timers.delete(id);
          t.cb();
        }
      }
    },
    armed(ms: number): number {
      return [...timers.values()].filter((t) => t.ms === ms).length;
    },
  };
}

/** A manual animation-frame scheduler. */
function createScheduler() {
  const pending = new Map<number, () => void>();
  let nextId = 1;
  return {
    schedule(cb: () => void): number {
      const id = nextId++;
      pending.set(id, cb);
      return id;
    },
    cancel(id: number): void {
      pending.delete(id);
    },
    flush(): void {
      const run = [...pending.values()];
      pending.clear();
      for (const cb of run) cb();
    },
    get size(): number {
      return pending.size;
    },
  };
}

const CONNECT_MS = 100;
const SLOW_MS = 500;
const frame = samples.eventFrame(samples.userMessageEvent("hi"));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StreamController", () => {
  let sink: ReturnType<typeof createTestSink>;
  let scheduler: ReturnType<typeof createScheduler>;
  let timers: ReturnType<typeof createManualTimers>;
  let controller: StreamController;

  beforeEach(() => {
    sink = createTestSink();
    scheduler = createScheduler();
    timers = createManualTimers();
    controller = new StreamController(sink, scheduler.schedule, scheduler.cancel, {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      connectTimeoutMs: CONNECT_MS,
      slowThresholdMs: SLOW_MS,
    });
  });

  it("starts idle and ignores frames, drops and errors while idle", () => {
    expect(controller.state).toEqual({ stage: "idle" });
    controller.handleFrame(frame);
    controller.handleReconnecting(1);
    controller.handleError(new Error("x"));
    expect(sink.frames).toEqual([]);
    expect(sink.states).toEqual([]);
    expect(sink.publishes).toBe(0);
  });

  it("enters connecting and arms both watchdogs", () => {
    controller.start("s1");
    expect(controller.state).toEqual({ stage: "connecting", sessionId: "s1" });
    expect(timers.armed(CONNECT_MS)).toBe(1);
    expect(timers.armed(SLOW_MS)).toBe(1);
  });

  it("moves to streaming on the first frame and coalesces publishes per flush", () => {
    controller.start("s1");
    controller.handleFrame(frame);
    controller.handleFrame(frame);
    controller.handleFrame(frame);

    expect(controller.state).toEqual({ stage: "streaming", sessionId: "s1" });
    expect(sink.states.map((s) => s.stage)).toEqual(["connecting", "streaming"]);
    expect(sink.frames).toHaveLength(3);
    expect(controller.hasPendingFlush).toBe(true);
    expect(scheduler.size).toBe(1);
    expect(sink.publishes).toBe(0);

    scheduler.flush();
    expect(sink.publishes).toBe(1);
    expect(controller.hasPendingFlush).toBe(false);
  });

  it("schedules no publish for a frame that changed nothing", () => {
    sink.changes = false;
    controller.start("s1");
    controller.handleFrame(frame);
    expect(controller.hasPendingFlush).toBe(false);
    expect(controller.state.stage).toBe("streaming");
  });

  it("a frame stands the connect watchdog down and restarts the slow window", () => {
    controller.start("s1");
    controller.handleFrame(frame);
    expect(timers.armed(CONNECT_MS)).toBe(0);
    expect(timers.armed(SLOW_MS)).toBe(1);
    timers.fire(CONNECT_MS);
    expect(sink.connectTimeouts).toBe(0);
  });

  it("reports a connect timeout only while still connecting", () => {
    controller.start("s1");
    timers.fire(CONNECT_MS);
    expect(sink.connectTimeouts).toBe(1);
  });

  it("raises the slow hint after a quiet stretch and clears it on the next frame", () => {
    controller.start("s1");
    controller.handleFrame(frame);
    sink.slow.length = 0;
    timers.fire(SLOW_MS);
    expect(sink.slow).toEqual([true]);

    controller.handleFrame(frame);
    expect(sink.slow).toEqual([true, false]);
  });

  it("enters reconnecting, standing the watchdogs down, and streams again on a frame", () => {
    controller.start("s1");
    controller.handleFrame(frame);
    controller.handleReconnecting(2);

    expect(controller.state).toEqual({ stage: "reconnecting", sessionId: "s1", attempt: 2 });
    expect(timers.armed(SLOW_MS)).toBe(0);
    expect(sink.slow.at(-1)).toBe(false);

    controller.handleFrame(frame);
    expect(controller.state).toEqual({ stage: "streaming", sessionId: "s1" });
  });

  it("publishes what was folded and enters error", () => {
    controller.start("s1");
    controller.handleFrame(frame);
    const error = new Error("refused");
    controller.handleError(error);

    expect(sink.publishes).toBe(1);
    expect(controller.hasPendingFlush).toBe(false);
    expect(controller.state).toEqual({ stage: "error", sessionId: "s1", error });
    expect(timers.armed(SLOW_MS)).toBe(0);
  });

  it("resets to idle, cancelling a pending publish, and stays quiet when already idle", () => {
    controller.start("s1");
    controller.handleFrame(frame);
    controller.reset();

    expect(controller.state).toEqual({ stage: "idle" });
    expect(scheduler.size).toBe(0);
    scheduler.flush();
    expect(sink.publishes).toBe(0);

    const transitions = sink.states.length;
    controller.reset();
    expect(sink.states).toHaveLength(transitions);
  });

  it("restarting cancels the previous session's pending publish", () => {
    controller.start("s1");
    controller.handleFrame(frame);
    controller.start("s2");
    expect(scheduler.size).toBe(0);
    expect(controller.state).toEqual({ stage: "connecting", sessionId: "s2" });
  });

  it("schedules on the platform's animation frame and timers by default", async () => {
    const defaults = createTestSink();
    const live = new StreamController(defaults);
    live.start("s1");
    live.handleFrame(frame);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(defaults.publishes).toBe(1);

    live.handleFrame(frame);
    live.reset();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(defaults.publishes).toBe(1);
  });

  it("falls back to timers where there is no animation frame, and cancels through them", async () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.stubGlobal("cancelAnimationFrame", undefined);
    try {
      const defaults = createTestSink();
      const live = new StreamController(defaults);
      live.start("s1");
      live.handleFrame(frame);
      live.reset();
      live.start("s1");
      live.handleFrame(frame);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(defaults.publishes).toBe(1);
      live.reset();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
