import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  StreamController,
  type StreamControllerSink,
} from "../stream-controller";
import type { StreamState } from "../store/conversation-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(
  phase: ExecutionPhase,
  messageCount = 0,
): AgentExecution {
  const exec = create(AgentExecutionSchema);
  const status = create(AgentExecutionStatusSchema);
  status.phase = phase;
  for (let i = 0; i < messageCount; i++) {
    status.messages.push({} as never);
  }
  exec.status = status;
  return exec;
}

function createTestSink(): StreamControllerSink & {
  snapshots: AgentExecution[];
  states: Array<{ stage: string; executionId?: string; error?: Error }>;
  connectTimeouts: number;
  slow: boolean[];
} {
  const snapshots: AgentExecution[] = [];
  const states: Array<{ stage: string; executionId?: string; error?: Error }> =
    [];
  const slow: boolean[] = [];
  const sink = {
    snapshots,
    states,
    connectTimeouts: 0,
    slow,
    ingestSnapshot(snapshot: AgentExecution) {
      snapshots.push(snapshot);
    },
    setStreamState(state: StreamState) {
      states.push(state as never);
    },
    onConnectTimeout() {
      sink.connectTimeouts += 1;
    },
    setSlow(value: boolean) {
      slow.push(value);
    },
  };
  return sink;
}

/**
 * Manual watchdog clock: records armed timers without firing them. Tests fire
 * a specific timer explicitly by its configured duration, so no real time is
 * consumed and existing (non-watchdog) tests are unaffected — their timers are
 * simply recorded and discarded.
 */
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
    /** Fire every currently-armed timer whose duration equals `ms`. */
    fire(ms: number): void {
      for (const [id, t] of [...timers]) {
        if (t.ms === ms) {
          timers.delete(id);
          t.cb();
        }
      }
    },
    get pending(): number {
      return timers.size;
    },
  };
}

type FlushCallback = () => void;

function createSynchronousScheduler() {
  const pending: Array<{ id: number; cb: FlushCallback }> = [];
  let nextId = 1;

  return {
    pending,
    schedule(cb: FlushCallback): number {
      const id = nextId++;
      pending.push({ id, cb });
      return id;
    },
    cancel(id: number): void {
      const idx = pending.findIndex((p) => p.id === id);
      if (idx !== -1) pending.splice(idx, 1);
    },
    flush(): void {
      const toRun = [...pending];
      pending.length = 0;
      for (const { cb } of toRun) cb();
    },
    get size() {
      return pending.length;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Distinct, small watchdog durations so a test can fire one timer without the
// other (the manual clock fires by exact duration).
const CONNECT_MS = 100;
const SLOW_MS = 500;

describe("StreamController", () => {
  let sink: ReturnType<typeof createTestSink>;
  let scheduler: ReturnType<typeof createSynchronousScheduler>;
  let timers: ReturnType<typeof createManualTimers>;
  let controller: StreamController;

  beforeEach(() => {
    sink = createTestSink();
    scheduler = createSynchronousScheduler();
    timers = createManualTimers();
    controller = new StreamController(sink, scheduler.schedule, scheduler.cancel, {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      connectTimeoutMs: CONNECT_MS,
      slowThresholdMs: SLOW_MS,
    });
  });

  describe("initial state", () => {
    it("starts in idle", () => {
      expect(controller.state).toEqual({ stage: "idle" });
    });

    it("has no pending flush", () => {
      expect(controller.hasPendingFlush).toBe(false);
    });
  });

  describe("start()", () => {
    it("transitions to connecting", () => {
      controller.start("exec-1");
      expect(controller.state).toEqual({
        stage: "connecting",
        executionId: "exec-1",
      });
    });

    it("notifies the sink of the state transition", () => {
      controller.start("exec-1");
      expect(sink.states).toEqual([
        { stage: "connecting", executionId: "exec-1" },
      ]);
    });

    it("resets when starting a different execution", () => {
      controller.start("exec-1");
      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS),
      );
      controller.start("exec-2");
      expect(controller.state).toEqual({
        stage: "connecting",
        executionId: "exec-2",
      });
      expect(scheduler.size).toBe(0);
    });
  });

  describe("handleSnapshot() — non-terminal", () => {
    beforeEach(() => {
      controller.start("exec-1");
      sink.states.length = 0;
    });

    it("transitions from connecting to streaming on first snapshot", () => {
      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS),
      );
      expect(controller.state).toEqual({
        stage: "streaming",
        executionId: "exec-1",
      });
    });

    it("buffers the snapshot (does not flush immediately)", () => {
      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS),
      );
      expect(sink.snapshots).toHaveLength(0);
      expect(controller.hasPendingFlush).toBe(true);
    });

    it("flushes on scheduler callback", () => {
      const snap = makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS);
      controller.handleSnapshot(snap);
      scheduler.flush();
      expect(sink.snapshots).toEqual([snap]);
      expect(controller.hasPendingFlush).toBe(false);
    });

    it("coalesces multiple snapshots into one flush", () => {
      const snap1 = makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS, 1);
      const snap2 = makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS, 2);
      const snap3 = makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS, 3);

      controller.handleSnapshot(snap1);
      controller.handleSnapshot(snap2);
      controller.handleSnapshot(snap3);

      expect(scheduler.size).toBe(1);
      scheduler.flush();
      expect(sink.snapshots).toEqual([snap3]);
    });

    it("schedules a new flush after the previous one fires", () => {
      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS, 1),
      );
      scheduler.flush();
      expect(scheduler.size).toBe(0);

      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS, 2),
      );
      expect(scheduler.size).toBe(1);
    });
  });

  describe("handleSnapshot() — terminal", () => {
    beforeEach(() => {
      controller.start("exec-1");
      sink.states.length = 0;
    });

    it("flushes immediately without waiting for scheduler", () => {
      const snap = makeSnapshot(ExecutionPhase.EXECUTION_COMPLETED);
      controller.handleSnapshot(snap);
      expect(sink.snapshots).toEqual([snap]);
      expect(scheduler.size).toBe(0);
    });

    it("transitions to complete", () => {
      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_COMPLETED),
      );
      expect(controller.state).toEqual({
        stage: "complete",
        executionId: "exec-1",
      });
    });

    it("cancels any pending non-terminal flush", () => {
      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS, 1),
      );
      expect(scheduler.size).toBe(1);

      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_COMPLETED),
      );
      expect(scheduler.size).toBe(0);
    });

    it("handles terminal as first snapshot (connecting -> complete)", () => {
      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_COMPLETED),
      );
      expect(controller.state).toEqual({
        stage: "complete",
        executionId: "exec-1",
      });
      expect(sink.states).toEqual([
        { stage: "complete", executionId: "exec-1" },
      ]);
    });

    it("handles EXECUTION_FAILED as terminal", () => {
      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_FAILED),
      );
      expect(controller.state.stage).toBe("complete");
    });

    it("handles EXECUTION_CANCELLED as terminal", () => {
      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_CANCELLED),
      );
      expect(controller.state.stage).toBe("complete");
    });

    it("handles EXECUTION_TERMINATED as terminal", () => {
      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_TERMINATED),
      );
      expect(controller.state.stage).toBe("complete");
    });
  });

  describe("handleStreamEnd()", () => {
    it("flushes buffered snapshot and transitions to complete", () => {
      controller.start("exec-1");
      const snap = makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS);
      controller.handleSnapshot(snap);
      controller.handleStreamEnd();

      expect(sink.snapshots).toEqual([snap]);
      expect(controller.state).toEqual({
        stage: "complete",
        executionId: "exec-1",
      });
    });

    it("no-ops if already complete (terminal snapshot already handled)", () => {
      controller.start("exec-1");
      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_COMPLETED),
      );
      sink.states.length = 0;

      controller.handleStreamEnd();
      expect(sink.states).toHaveLength(0);
    });

    it("no-ops if idle", () => {
      controller.handleStreamEnd();
      expect(sink.states).toHaveLength(0);
    });
  });

  describe("handleError()", () => {
    it("transitions to error state", () => {
      controller.start("exec-1");
      const err = new Error("network timeout");
      controller.handleError(err);

      expect(controller.state).toEqual({
        stage: "error",
        executionId: "exec-1",
        error: err,
      });
    });

    it("flushes buffered snapshot before transitioning", () => {
      controller.start("exec-1");
      const snap = makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS);
      controller.handleSnapshot(snap);
      controller.handleError(new Error("fail"));

      expect(sink.snapshots).toEqual([snap]);
    });

    it("cancels pending rAF", () => {
      controller.start("exec-1");
      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS),
      );
      expect(scheduler.size).toBe(1);

      controller.handleError(new Error("fail"));
      expect(scheduler.size).toBe(0);
    });

    it("no-ops if idle", () => {
      controller.handleError(new Error("orphan"));
      expect(sink.states).toHaveLength(0);
    });
  });

  describe("reset()", () => {
    it("transitions to idle", () => {
      controller.start("exec-1");
      controller.reset();
      expect(controller.state).toEqual({ stage: "idle" });
    });

    it("cancels pending flush", () => {
      controller.start("exec-1");
      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS),
      );
      controller.reset();
      expect(scheduler.size).toBe(0);
      expect(controller.hasPendingFlush).toBe(false);
    });

    it("clears buffered snapshot", () => {
      controller.start("exec-1");
      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS),
      );
      controller.reset();
      scheduler.flush();
      expect(sink.snapshots).toHaveLength(0);
    });

    it("no-ops if already idle", () => {
      controller.reset();
      expect(sink.states).toHaveLength(0);
    });

    it("notifies sink of idle transition", () => {
      controller.start("exec-1");
      sink.states.length = 0;
      controller.reset();
      expect(sink.states).toEqual([{ stage: "idle" }]);
    });
  });

  describe("stale event guard", () => {
    it("ignores snapshots after reset", () => {
      controller.start("exec-1");
      controller.reset();
      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS),
      );
      expect(sink.snapshots).toHaveLength(0);
    });

    it("ignores errors after reset", () => {
      controller.start("exec-1");
      controller.reset();
      controller.handleError(new Error("stale"));
      expect(controller.state).toEqual({ stage: "idle" });
    });
  });

  describe("watchdog — connect timeout", () => {
    it("fires onConnectTimeout while still connecting", () => {
      controller.start("exec-1");
      timers.fire(CONNECT_MS);
      expect(sink.connectTimeouts).toBe(1);
    });

    it("does not fire once a first snapshot arrives (connect timer cleared)", () => {
      controller.start("exec-1");
      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS),
      );
      timers.fire(CONNECT_MS);
      expect(sink.connectTimeouts).toBe(0);
    });

    it("does not fire after a terminal snapshot", () => {
      controller.start("exec-1");
      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_FAILED),
      );
      timers.fire(CONNECT_MS);
      expect(sink.connectTimeouts).toBe(0);
    });

    it("does not fire after reset", () => {
      controller.start("exec-1");
      controller.reset();
      timers.fire(CONNECT_MS);
      expect(sink.connectTimeouts).toBe(0);
    });

    it("stands down while auto-reconnect is in flight", () => {
      controller.start("exec-1");
      controller.handleReconnecting(1, new Error("drop"));
      timers.fire(CONNECT_MS);
      expect(sink.connectTimeouts).toBe(0);
    });
  });

  describe("watchdog — slow stall", () => {
    it("sets the slow hint after the threshold while streaming", () => {
      controller.start("exec-1");
      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS),
      );
      timers.fire(SLOW_MS);
      expect(sink.slow.at(-1)).toBe(true);
    });

    it("clears the slow hint on the next snapshot", () => {
      controller.start("exec-1");
      timers.fire(SLOW_MS);
      expect(sink.slow.at(-1)).toBe(true);

      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS),
      );
      // Re-arming on a fresh snapshot clears the prior hint.
      expect(sink.slow.at(-1)).toBe(false);
    });

    it("clears the slow hint on a terminal snapshot", () => {
      controller.start("exec-1");
      timers.fire(SLOW_MS);
      expect(sink.slow.at(-1)).toBe(true);

      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_COMPLETED),
      );
      expect(sink.slow.at(-1)).toBe(false);
    });

    it("clears the slow hint and timer on reset", () => {
      controller.start("exec-1");
      timers.fire(SLOW_MS);
      controller.reset();
      expect(sink.slow.at(-1)).toBe(false);
      // The (already fired) timer leaves nothing armed; a stray fire is a no-op.
      const before = sink.slow.length;
      timers.fire(SLOW_MS);
      expect(sink.slow.length).toBe(before);
    });

    it("does not fire after reaching a terminal phase", () => {
      controller.start("exec-1");
      controller.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_COMPLETED),
      );
      const before = sink.slow.length;
      timers.fire(SLOW_MS);
      expect(sink.slow.length).toBe(before);
    });
  });

  describe("default constructor (browser rAF binding)", () => {
    let mockRaf: ReturnType<typeof vi.fn>;
    let mockCaf: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      let nextId = 1;
      mockRaf = vi.fn((cb: () => void) => {
        const id = nextId++;
        setTimeout(cb, 0);
        return id;
      });
      mockCaf = vi.fn();

      vi.stubGlobal("requestAnimationFrame", mockRaf);
      vi.stubGlobal("cancelAnimationFrame", mockCaf);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("does not throw when using default scheduleFlush/cancelFlush", () => {
      const defaultController = new StreamController(sink, undefined, undefined, {
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
      });
      defaultController.start("exec-1");

      expect(() => {
        defaultController.handleSnapshot(
          makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS),
        );
      }).not.toThrow();

      expect(mockRaf).toHaveBeenCalledOnce();
    });

    it("delegates cancelFlush to cancelAnimationFrame", () => {
      const defaultController = new StreamController(sink, undefined, undefined, {
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
      });
      defaultController.start("exec-1");
      defaultController.handleSnapshot(
        makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS),
      );
      defaultController.reset();

      expect(mockCaf).toHaveBeenCalledOnce();
    });
  });
});
