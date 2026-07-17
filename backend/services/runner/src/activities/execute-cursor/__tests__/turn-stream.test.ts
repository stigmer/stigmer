/**
 * Unit tests for the Cursor harness's shared stream seam (turn-stream.ts).
 *
 * These lock the behaviors the old bare retry loops used to DROP — live persist,
 * DD-32/DD-33 mid-run progress, sub-agent tracking, the first-denial early stop,
 * and correct pause/platform-stop mapping — so that unifying the primary turn and
 * both recovery retries onto this one loop cannot silently regress any of them.
 *
 * The loop is driven with a structural `mockRun` (an async-iterable `.stream()`)
 * and injected `heartbeat`/`isCancelled`, so it runs without the live Cursor SDK
 * or Temporal — mirroring the deep-agent `streaming.test.ts` pattern.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionControlSignal } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { CancelledFailure } from "@temporalio/activity";
import type { SDKMessage } from "@cursor/sdk";
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

function stubUsageAccumulator() {
  return {
    addTurn: vi.fn(),
    // hasTurns:false keeps the loop from building a StreamingUsageSummary (which
    // would need a real snapshot); usage plumbing is covered by usage-accumulator's
    // own tests.
    hasTurns: false,
    snapshot: vi.fn(() => ({ inputTokens: 0n, outputTokens: 0n })),
  };
}

interface BuiltDeps {
  deps: CursorTurnStreamDeps;
  state: TurnStreamState;
  persist: ReturnType<typeof vi.fn>;
  accumulator: ReturnType<typeof stubAccumulator>;
  status: ReturnType<typeof create<typeof AgentExecutionStatusSchema>>;
}

function buildDeps(overrides: Partial<CursorTurnStreamDeps> = {}): BuiltDeps {
  const state = overrides.state ?? newTurnStreamState();
  const status = overrides.status ?? create(AgentExecutionStatusSchema, {});
  const accumulator = (overrides.accumulator as unknown as ReturnType<typeof stubAccumulator>) ??
    stubAccumulator();
  const persist =
    (overrides.persist as ReturnType<typeof vi.fn>) ??
    vi.fn(async () => ExecutionControlSignal.UNSPECIFIED);

  const deps = {
    // TurnOnDeltaDeps
    usageAccumulator: stubUsageAccumulator(),
    deltaEnricher: stubEnricher(),
    heartbeat: vi.fn(),
    promptEstimatedTokens: 100,
    executionId: "exec-test",
    state,
    maxCostUsd: 0,
    // CursorTurnStreamDeps
    status,
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
    stallTimeoutMs: 120_000,
    persist,
    isCancelled: () => false,
    ...overrides,
  } as unknown as CursorTurnStreamDeps;

  return { deps, state, persist, accumulator, status };
}

describe("consumeCursorTurnStream", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("processes every event, persists live, and returns 'completed' on a natural end", async () => {
    const { deps, state, persist, accumulator } = buildDeps();

    const reason = await consumeCursorTurnStream(
      mockRun([ev({ type: "assistant" }), ev({ type: "assistant" })]),
      deps,
    );

    expect(reason).toBe("completed");
    expect(accumulator.processEvent).toHaveBeenCalledTimes(2);
    // The #1 retry gap: the bare loop never persisted mid-stream. This proves the
    // shared loop persists live.
    expect(persist).toHaveBeenCalled();
    expect(state.eventCount).toBe(2);
  });

  it("tracks a sub-agent delegation (the 'task' tool call) — dropped by the old bare retry loop", async () => {
    const { deps, accumulator } = buildDeps();

    await consumeCursorTurnStream(
      mockRun([ev({ type: "tool_call", name: "task" })]),
      deps,
    );

    expect(accumulator.trackSubAgentExecution).toHaveBeenCalledTimes(1);
  });

  it("attaches DD-32/DD-33 mid-run progress when a substrate is present", async () => {
    const capture = vi.fn(async () => ({ delta: { entries: [] }, changed: true }));
    const progressSubstrate = { capture } as unknown as ProgressSubstrate;
    const { deps, status } = buildDeps({ progressSubstrate });

    await consumeCursorTurnStream(mockRun([ev({ type: "assistant" })]), deps);

    expect(capture).toHaveBeenCalled();
    // changed:true → the transient snapshot is attached to status.
    expect(status.fileChangeProgress).toBeDefined();
  });

  it("does not touch progress when no substrate is configured", async () => {
    const { deps, status } = buildDeps({ progressSubstrate: undefined });

    await consumeCursorTurnStream(mockRun([ev({ type: "assistant" })]), deps);

    expect(status.fileChangeProgress).toBeUndefined();
  });

  it("returns 'paused' and sets pauseDetected when the activity is cancelled", async () => {
    const { deps, state, accumulator } = buildDeps({ isCancelled: () => true });

    const reason = await consumeCursorTurnStream(mockRun([ev({ type: "assistant" })]), deps);

    expect(reason).toBe("paused");
    expect(state.pauseDetected).toBe(true);
    // Cancellation is checked before the event is processed.
    expect(accumulator.processEvent).not.toHaveBeenCalled();
  });

  it("returns 'platform-stop' when a persist reports the STOP control signal", async () => {
    const persist = vi.fn(async () => ExecutionControlSignal.STOP);
    const { deps, state } = buildDeps({ persist });

    const reason = await consumeCursorTurnStream(
      mockRun([ev({ type: "assistant" }), ev({ type: "assistant" })]),
      deps,
    );

    expect(reason).toBe("platform-stop");
    expect(state.platformStopSignaled).toBe(true);
    // Broke after the first persist — the second event never persisted.
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("captures a stream ERROR status message onto state.streamErrorMessage", async () => {
    const { deps, state } = buildDeps();

    await consumeCursorTurnStream(
      mockRun([ev({ type: "status", status: "ERROR", message: "boom" })]),
      deps,
    );

    expect(state.streamErrorMessage).toBe("boom");
  });

  describe("first-denial early stop", () => {
    let hitlDir: string;

    afterEach(async () => {
      if (hitlDir) await rm(hitlDir, { recursive: true, force: true });
    });

    it("stops the turn, cancels the run, and arms denialCancelSettled on a ledger entry", async () => {
      hitlDir = await mkdtemp(join(tmpdir(), "turn-stream-denial-"));
      await writeFile(
        join(hitlDir, "denials.jsonl"),
        JSON.stringify({ toolName: "shell", token: "tok-1" }) + "\n",
        "utf-8",
      );
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

      const reason = await consumeCursorTurnStream(
        mockRun([ev({ type: "tool_call", name: "shell" })]),
        deps,
      );

      expect(reason).toBe("completed");
      expect(state.firstDenialDetected).toBe(false);
    });
  });

  describe("cost-cap stop", () => {
    it("cancels the run, stops the stream, and returns 'cost-cap' when onDelta flagged the overrun", async () => {
      const state = newTurnStreamState();
      state.costCapExceeded = true; // onDelta's write, simulated
      const { deps, accumulator } = buildDeps({ state });
      const run = mockRun([ev({ type: "assistant" }), ev({ type: "assistant" })]);

      const reason = await consumeCursorTurnStream(run, deps);

      expect(reason).toBe("cost-cap");
      expect(run.cancel).toHaveBeenCalled();
      // The break happens before the event is processed — no post-cap content.
      expect(accumulator.processEvent).not.toHaveBeenCalled();
    });

    it("detects the flag mid-stream when onDelta sets it between events", async () => {
      const state = newTurnStreamState();
      const { deps, accumulator } = buildDeps({ state });
      // Simulate onDelta's write landing between event 1 and event 2 — the
      // realistic shape: a turn-ended usage delta crosses the cap while the
      // loop is between stream events.
      async function* gen(): AsyncIterable<SDKMessage> {
        yield ev({ type: "assistant" });
        state.costCapExceeded = true;
        yield ev({ type: "assistant" });
      }
      const run: MockRun = {
        stream: () => gen(),
        supports: () => true,
        cancel: vi.fn(async () => {}),
      };

      const reason = await consumeCursorTurnStream(run, deps);

      expect(reason).toBe("cost-cap");
      expect(run.cancel).toHaveBeenCalled();
      // Event 1 was processed; event 2 hit the break before processing.
      expect(accumulator.processEvent).toHaveBeenCalledTimes(1);
    });

    it("swallows the cancel-induced teardown rejection (expected, not a failure)", async () => {
      const state = newTurnStreamState();
      state.costCapExceeded = true;
      const { deps } = buildDeps({ state });
      // The break exits the for-await, which invokes the iterator's return();
      // a cancelled SDK run can reject there. The catch must exempt cost-cap
      // teardown exactly like stall/first-denial teardown.
      const events = [ev({ type: "assistant" })];
      let i = 0;
      const run: MockRun = {
        stream: () => ({
          [Symbol.asyncIterator]: () => ({
            next: async () =>
              i < events.length
                ? { value: events[i++], done: false as const }
                : { value: undefined, done: true as const },
            return: async () => {
              throw new Error("run cancelled");
            },
          }),
        }),
        supports: () => true,
        cancel: vi.fn(async () => {}),
      };

      const reason = await consumeCursorTurnStream(run, deps);

      expect(reason).toBe("cost-cap");
      expect(run.cancel).toHaveBeenCalled();
    });
  });

  it("returns 'stalled' and cancels the run when the stall watchdog fires", async () => {
    vi.useFakeTimers();
    // The generator yields one event, then awaits a promise resolved only by
    // run.cancel() — so the loop is suspended when the watchdog fires.
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
    const { deps, state } = buildDeps({ stallTimeoutMs: 40 });

    const pending = consumeCursorTurnStream(run, deps);
    // Advance past the stall window (tick = stallMs/4 = 10ms), flushing the
    // microtasks between ticks so the loop reaches its await first.
    await vi.advanceTimersByTimeAsync(80);
    const reason = await pending;

    expect(reason).toBe("stalled");
    expect(state.stallDetected).toBe(true);
    expect(run.cancel).toHaveBeenCalled();
  });
});

describe("makeCursorTurnOnDelta", () => {
  it("flags a pause (not a throw) when the heartbeat reports CancelledFailure", () => {
    const state = newTurnStreamState();
    const onDelta = makeCursorTurnOnDelta({
      usageAccumulator: stubUsageAccumulator() as never,
      deltaEnricher: stubEnricher() as never,
      heartbeat: () => {
        throw new CancelledFailure("paused");
      },
      promptEstimatedTokens: 10,
      executionId: "e",
      state,
      maxCostUsd: 0,
    });

    expect(() => onDelta({ update: { type: "text" } as never })).not.toThrow();
    expect(state.pauseDetected).toBe(true);
  });

  it("rethrows a non-cancellation heartbeat error", () => {
    const state = newTurnStreamState();
    const onDelta = makeCursorTurnOnDelta({
      usageAccumulator: stubUsageAccumulator() as never,
      deltaEnricher: stubEnricher() as never,
      heartbeat: () => {
        throw new Error("boom");
      },
      promptEstimatedTokens: 10,
      executionId: "e",
      state,
      maxCostUsd: 0,
    });

    expect(() => onDelta({ update: { type: "text" } as never })).toThrow("boom");
    expect(state.pauseDetected).toBe(false);
  });

  it("accumulates turn usage and logs first-turn attribution exactly once", () => {
    const state = newTurnStreamState();
    const usageAccumulator = stubUsageAccumulator();
    const onDelta = makeCursorTurnOnDelta({
      usageAccumulator: usageAccumulator as never,
      deltaEnricher: stubEnricher() as never,
      heartbeat: vi.fn(),
      promptEstimatedTokens: 10,
      executionId: "e",
      state,
      maxCostUsd: 0,
    });

    onDelta({ update: { type: "turn-ended", usage: { inputTokens: 100 } } as never });
    onDelta({ update: { type: "turn-ended", usage: { inputTokens: 50 } } as never });

    expect(usageAccumulator.addTurn).toHaveBeenCalledTimes(2);
    expect(state.firstTurnAttributionLogged).toBe(true);
  });

  it("flags costCapExceeded when a turn-ended usage delta pushes the estimate past the cap", () => {
    const state = newTurnStreamState();
    const usageAccumulator = {
      ...stubUsageAccumulator(),
      snapshot: vi.fn(() => ({ estimatedCostUsd: 0.51 })),
    };
    const onDelta = makeCursorTurnOnDelta({
      usageAccumulator: usageAccumulator as never,
      deltaEnricher: stubEnricher() as never,
      heartbeat: vi.fn(),
      promptEstimatedTokens: 10,
      executionId: "e",
      state,
      maxCostUsd: 0.5,
    });

    onDelta({ update: { type: "turn-ended", usage: { inputTokens: 100 } } as never });

    expect(state.costCapExceeded).toBe(true);
  });

  it("never flags costCapExceeded when no cap is configured", () => {
    const state = newTurnStreamState();
    const usageAccumulator = {
      ...stubUsageAccumulator(),
      snapshot: vi.fn(() => ({ estimatedCostUsd: 999 })),
    };
    const onDelta = makeCursorTurnOnDelta({
      usageAccumulator: usageAccumulator as never,
      deltaEnricher: stubEnricher() as never,
      heartbeat: vi.fn(),
      promptEstimatedTokens: 10,
      executionId: "e",
      state,
      maxCostUsd: 0,
    });

    onDelta({ update: { type: "turn-ended", usage: { inputTokens: 100 } } as never });

    expect(state.costCapExceeded).toBe(false);
  });
});
