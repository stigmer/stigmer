/**
 * Unit tests for the Cursor harness's shared stream seam (turn-stream.ts).
 *
 * These lock the behaviors the old bare retry loops used to DROP — live persist,
 * DD-32/DD-33 mid-run progress, sub-agent tracking, the first-denial early stop
 * — and the loop's side of the adapter contract: progress reported per event
 * and per delta, usage reported priced, the persist awaited, and the runtime's
 * stop signal honoured at every event boundary and inside a blocked pull by
 * cancelling the SDK run. Since S2 M3 the loop no longer decides WHY it
 * stopped (stall, cost cap, pause, platform stop are the runtime's evidence;
 * `harness/__tests__/run-turn.test.ts` proves that table); it reports
 * `completed`, `first-denial` or `interrupted`.
 *
 * The loop is driven with a structural `mockRun` (an async-iterable `.stream()`)
 * and the kit's `RecordingTurnSink`, so it runs without the live Cursor SDK or
 * Temporal — mirroring the deep-agent `streaming.test.ts` pattern.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@cursor/sdk";
import { RecordingTurnSink } from "../../../__test-utils__/harness-contract/recording-sink.js";
import {
  consumeCursorTurnStream,
  makeCursorTurnOnDelta,
  newTurnStreamState,
  type CursorTurnStreamDeps,
  type StreamableRun,
  type TurnStreamState,
} from "../turn-stream.js";
import type { ProgressSubstrate } from "../../../shared/filereview/progress.js";

// A stream event is only inspected by the loop for `type`/`name`/`status`/
// `message`; the accumulator (stubbed) owns the rest, so a minimal cast is safe.
function ev(obj: Record<string, unknown>): SDKMessage {
  return obj as unknown as SDKMessage;
}

async function* asyncIter(events: SDKMessage[]): AsyncIterable<SDKMessage> {
  for (const e of events) yield e;
}

interface MockRun extends StreamableRun {
  cancel: ReturnType<typeof vi.fn>;
}

function mockRun(events: SDKMessage[]): MockRun {
  return {
    stream: () => asyncIter(events),
    supports: () => true,
    cancel: vi.fn(async () => {}),
  };
}

function stubAccumulator(overrides: Record<string, unknown> = {}) {
  return {
    processEvent: vi.fn(),
    trackSubAgentExecution: vi.fn(),
    finalize: vi.fn(),
    markPersisted: vi.fn(),
    cancelInProgressSubAgents: vi.fn(),
    isDirty: true,
    subAgentExecutions: [],
    ...overrides,
  };
}

function stubEnricher() {
  return {
    processDelta: vi.fn(),
    applyEnrichments: vi.fn(),
    finalize: vi.fn(),
    markPersisted: vi.fn(),
    isDirty: false,
  };
}

/** Prices nothing: hands the counts back as a delta with a stated cost, so the sink sees a priced delta. */
function stubUsagePricer() {
  return { price: vi.fn((usage: Record<string, number>) => ({ ...usage, estimatedCostUsd: 0.01, model: "m" })) };
}

interface BuiltDeps {
  deps: CursorTurnStreamDeps;
  state: TurnStreamState;
  sink: RecordingTurnSink;
  accumulator: ReturnType<typeof stubAccumulator>;
}

function buildDeps(overrides: Partial<CursorTurnStreamDeps> = {}): BuiltDeps {
  const state = overrides.state ?? newTurnStreamState();
  const sink = (overrides.sink as RecordingTurnSink | undefined) ?? new RecordingTurnSink();
  const accumulator = (overrides.accumulator as unknown as ReturnType<typeof stubAccumulator>) ?? stubAccumulator();

  const deps = {
    // TurnOnDeltaDeps
    sink,
    usagePricer: stubUsagePricer(),
    deltaEnricher: stubEnricher(),
    promptEstimatedTokens: 100,
    executionId: "exec-test",
    state,
    // CursorTurnStreamDeps
    accumulator,
    todoTracker: { processEvent: vi.fn(), markPersisted: vi.fn(), isDirty: false },
    eventRecorder: undefined,
    // contentDirty (accumulator.isDirty) forces the persist, so shouldSendUpdate
    // is never consulted; markUpdateSent must still exist.
    scheduler: { shouldSendUpdate: () => false, markUpdateSent: vi.fn() },
    progressSubstrate: undefined,
    progressState: { lastAtMs: 0 },
    changeSetId: "exec-test:0",
    hitlDir: undefined,
    ...overrides,
  } as unknown as CursorTurnStreamDeps;

  return { deps, state, sink, accumulator };
}

describe("consumeCursorTurnStream", () => {
  it("processes every event, persists live through the sink, and returns 'completed' on a natural end", async () => {
    const { deps, state, sink, accumulator } = buildDeps();

    const reason = await consumeCursorTurnStream(mockRun([ev({ type: "assistant" }), ev({ type: "assistant" })]), deps);

    expect(reason).toBe("completed");
    expect(accumulator.processEvent).toHaveBeenCalledTimes(2);
    // The #1 retry gap: the bare loop never persisted mid-stream. This proves the
    // shared loop persists live — through the runtime's chokepoint.
    expect(sink.persistRequests).toBeGreaterThan(0);
    expect(state.eventCount).toBe(2);
  });

  it("reports progress per event, naming the tool of a tool_call event (the stall copy's `last tool`)", async () => {
    const { deps, sink } = buildDeps();

    await consumeCursorTurnStream(mockRun([ev({ type: "assistant" }), ev({ type: "tool_call", name: "shell" })]), deps);

    const marks = sink.events.filter((e) => e.kind === "activity");
    expect(marks.map((m) => (m.kind === "activity" ? m.detail : undefined))).toEqual([undefined, "shell"]);
  });

  it("tracks a sub-agent delegation (the 'task' tool call) — dropped by the old bare retry loop", async () => {
    const { deps, accumulator } = buildDeps();

    await consumeCursorTurnStream(mockRun([ev({ type: "tool_call", name: "task" })]), deps);

    expect(accumulator.trackSubAgentExecution).toHaveBeenCalledTimes(1);
  });

  it("attaches DD-32/DD-33 mid-run progress when a substrate is present", async () => {
    const capture = vi.fn(async () => ({ delta: { entries: [] }, changed: true }));
    const progressSubstrate = { capture } as unknown as ProgressSubstrate;
    const { deps, sink } = buildDeps({ progressSubstrate });

    await consumeCursorTurnStream(mockRun([ev({ type: "assistant" })]), deps);

    expect(capture).toHaveBeenCalled();
    // changed:true → the transient snapshot is attached to status.
    expect(sink.status.fileChangeProgress).toBeDefined();
  });

  it("does not touch progress when no substrate is configured", async () => {
    const { deps, sink } = buildDeps({ progressSubstrate: undefined });

    await consumeCursorTurnStream(mockRun([ev({ type: "assistant" })]), deps);

    expect(sink.status.fileChangeProgress).toBeUndefined();
  });

  it("captures a stream ERROR status message onto state.streamErrorMessage", async () => {
    const { deps, state } = buildDeps();

    await consumeCursorTurnStream(mockRun([ev({ type: "status", status: "ERROR", message: "boom" })]), deps);

    expect(state.streamErrorMessage).toBe("boom");
  });

  it("does not capture a non-string stream ERROR message (oss#299 hardening)", async () => {
    // message is untyped at runtime; a structured value assigned here would
    // crash classifyText downstream (.toLowerCase() on a non-string).
    const { deps, state } = buildDeps();

    await consumeCursorTurnStream(mockRun([ev({ type: "status", status: "ERROR", message: { code: 14 } })]), deps);

    expect(state.streamErrorMessage).toBeUndefined();
  });

  describe("first-denial early stop", () => {
    let hitlDir: string;

    afterEach(async () => {
      if (hitlDir) await rm(hitlDir, { recursive: true, force: true });
    });

    it("stops the turn, cancels the run, and arms denialCancelSettled on a ledger entry", async () => {
      hitlDir = await mkdtemp(join(tmpdir(), "turn-stream-denial-"));
      await writeFile(join(hitlDir, "denials.jsonl"), JSON.stringify({ toolName: "shell", token: "tok-1" }) + "\n", "utf-8");
      const { deps, state } = buildDeps({ hitlDir });
      const run = mockRun([ev({ type: "tool_call", name: "shell" })]);

      const reason = await consumeCursorTurnStream(run, deps);

      expect(reason).toBe("first-denial");
      expect(state.firstDenialDetected).toBe(true);
      expect(run.cancel).toHaveBeenCalled();
      expect(state.denialCancelSettled).toBeDefined();
    });

    it("does not stop when the ledger is empty", async () => {
      hitlDir = await mkdtemp(join(tmpdir(), "turn-stream-nodenial-"));
      await writeFile(join(hitlDir, "denials.jsonl"), "", "utf-8");
      const { deps, state } = buildDeps({ hitlDir });

      const reason = await consumeCursorTurnStream(mockRun([ev({ type: "tool_call", name: "shell" })]), deps);

      expect(reason).toBe("completed");
      expect(state.firstDenialDetected).toBe(false);
    });
  });

  describe("the runtime's stop signal", () => {
    it("a signal aborted before the stream starts: the run is cancelled and nothing is processed", async () => {
      const sink = new RecordingTurnSink();
      sink.abort("cost-cap");
      const { deps, accumulator } = buildDeps({ sink });
      const run = mockRun([ev({ type: "assistant" })]);

      const reason = await consumeCursorTurnStream(run, deps);

      expect(reason).toBe("interrupted");
      expect(run.cancel).toHaveBeenCalledTimes(1);
      expect(accumulator.processEvent).not.toHaveBeenCalled();
    });

    it("an abort between events: the run is cancelled at once and the next event is never processed", async () => {
      const sink = new RecordingTurnSink();
      const { deps, accumulator } = buildDeps({ sink });
      // The realistic shape: the runtime aborts (a turn-ended delta crossed the
      // cap, a STOP came back from a persist) while the loop is between events.
      async function* gen(): AsyncIterable<SDKMessage> {
        yield ev({ type: "assistant" });
        sink.abort("platform-stop");
        yield ev({ type: "assistant" });
      }
      const run: MockRun = { stream: () => gen(), supports: () => true, cancel: vi.fn(async () => {}) };

      const reason = await consumeCursorTurnStream(run, deps);

      expect(reason).toBe("interrupted");
      expect(run.cancel).toHaveBeenCalledTimes(1);
      // Event 1 was processed; event 2 hit the boundary check.
      expect(accumulator.processEvent).toHaveBeenCalledTimes(1);
    });

    it("an abort while the pull is blocked (a wedged stream): the cancel is what unblocks it", async () => {
      const sink = new RecordingTurnSink();
      const { deps } = buildDeps({ sink });
      // The generator yields one event, then awaits a promise resolved only by
      // run.cancel() — the loop is suspended inside the pull when the runtime's
      // watchdog aborts.
      let unblock: (() => void) | undefined;
      async function* gen(): AsyncIterable<SDKMessage> {
        yield ev({ type: "assistant" });
        await new Promise<void>((resolve) => {
          unblock = resolve;
        });
      }
      const run: MockRun = {
        stream: () => gen(),
        supports: () => true,
        cancel: vi.fn(async () => {
          unblock?.();
        }),
      };

      const pending = consumeCursorTurnStream(run, deps);
      await vi.waitFor(() => expect(unblock).toBeDefined());
      sink.abort("stall");
      const reason = await pending;

      expect(reason).toBe("interrupted");
      expect(run.cancel).toHaveBeenCalledTimes(1);
    });

    it("swallows the cancel-induced teardown rejection (expected, not a failure)", async () => {
      const sink = new RecordingTurnSink();
      const { deps } = buildDeps({ sink });
      // The break exits the for-await, which invokes the iterator's return();
      // a cancelled SDK run can reject there. The catch must exempt a stopped
      // turn's teardown exactly like the first-denial teardown.
      const events = [ev({ type: "assistant" })];
      let i = 0;
      const run: MockRun = {
        stream: () => ({
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              if (i === 1) sink.abort("cost-cap");
              return i < events.length ? { value: events[i++], done: false as const } : { value: undefined, done: true as const };
            },
            return: async () => {
              throw new Error("run cancelled");
            },
          }),
        }),
        supports: () => true,
        cancel: vi.fn(async () => {}),
      };

      const reason = await consumeCursorTurnStream(run, deps);

      expect(reason).toBe("interrupted");
      expect(run.cancel).toHaveBeenCalled();
    });

    it("rethrows a genuine stream failure when nothing stopped the turn", async () => {
      const { deps } = buildDeps();
      async function* gen(): AsyncIterable<SDKMessage> {
        yield ev({ type: "assistant" });
        throw new Error("transport reset");
      }
      const run: MockRun = { stream: () => gen(), supports: () => true, cancel: vi.fn(async () => {}) };

      await expect(consumeCursorTurnStream(run, deps)).rejects.toThrow("transport reset");
    });
  });
});

describe("makeCursorTurnOnDelta", () => {
  it("reports every delta as progress and every turn-ended usage priced, logging first-turn attribution exactly once", () => {
    const state = newTurnStreamState();
    const sink = new RecordingTurnSink();
    const usagePricer = stubUsagePricer();
    const onDelta = makeCursorTurnOnDelta({
      sink,
      usagePricer: usagePricer as never,
      deltaEnricher: stubEnricher() as never,
      promptEstimatedTokens: 10,
      executionId: "e",
      state,
    });

    onDelta({ update: { type: "text" } as never });
    onDelta({ update: { type: "turn-ended", usage: { inputTokens: 100 } } as never });
    onDelta({ update: { type: "turn-ended", usage: { inputTokens: 50 } } as never });

    expect(sink.activityMarks).toBe(3);
    expect(usagePricer.price).toHaveBeenCalledTimes(2);
    expect(sink.usageDeltas.map((d) => d.inputTokens)).toEqual([100, 50]);
    expect(sink.usageDeltas.every((d) => d.estimatedCostUsd === 0.01), "the delta reaches the sink priced").toBe(true);
    expect(state.firstTurnAttributionLogged).toBe(true);
  });
});
