/**
 * Unit tests for the Cursor harness's shared stream seam (turn-stream.ts).
 *
 * These lock the behaviors the old bare retry loops used to DROP — live persist,
 * sub-agent tracking, the first-denial early stop — and the loop's side of the adapter contract: progress reported per event
 * and per delta, usage reported priced, the persist awaited, and the runtime's
 * stop signal honoured at every event boundary and inside a blocked pull by
 * cancelling the SDK run. Since S2 M3 the loop no longer decides WHY it
 * stopped (stall, cost cap, pause, platform stop are the runtime's evidence;
 * `harness/__tests__/run-turn.test.ts` proves that table); it reports
 * `completed`, `first-denial` or `interrupted`.
 *
 * The loop is driven with a structural `mockRun` (an async-iterable `.stream()`)
 * and the kit's `RecordingTurnSink`, so it runs without the live Cursor SDK or
 * Temporal — mirroring the deep-agent `streaming.test.ts` pattern. The
 * transcript side is the REAL pair the loop runs in production — the Cursor
 * translator into the shared `TranscriptBuilder` over `sink.status` (S4 M4;
 * until then a stubbed accumulator counted calls) — so what these arms read
 * back are rows, not mock invocations.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@cursor/sdk";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { RecordingTurnSink } from "../../../__test-utils__/harness-contract/recording-sink.js";
import { TranscriptBuilder } from "../../../harness/transcript/builder.js";
import { sdkEvents } from "../__test-utils__/scripted-agent.js";
import { CursorTranslator } from "../translator.js";
import {
  consumeCursorTurnStream,
  makeCursorTurnOnDelta,
  newTurnStreamState,
  type CursorTurnStreamDeps,
  type StreamableRun,
  type TurnStreamState,
} from "../turn-stream.js";

/** The SDK's real event shapes, bound to one run, so the translator folds them as production would. */
const sdk = sdkEvents("agent-test", "run-test");
/** A `status` event whose `message` is deliberately NOT a string — the oss#299 shape the loop must not crash on. */
function statusWithStructuredMessage(): SDKMessage {
  return { type: "status", agent_id: "agent-test", run_id: "run-test", status: "ERROR", message: { code: 14 } } as unknown as SDKMessage;
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

function translatorFor(sink: RecordingTurnSink): CursorTranslator {
  return new CursorTranslator({ policies: new Map(), leases: { global: false, categories: new Set() }, seeded: sink.status.messages });
}

/** Prices nothing: hands the counts back as a delta with a stated cost, so the sink sees a priced delta. */
function stubUsagePricer() {
  return { price: vi.fn((usage: Record<string, number>) => ({ ...usage, estimatedCostUsd: 0.01, model: "m" })) };
}

interface BuiltDeps {
  deps: CursorTurnStreamDeps;
  state: TurnStreamState;
  sink: RecordingTurnSink;
  transcript: TranscriptBuilder;
}

function buildDeps(overrides: Partial<CursorTurnStreamDeps> = {}): BuiltDeps {
  const state = overrides.state ?? newTurnStreamState();
  const sink = (overrides.sink as RecordingTurnSink | undefined) ?? new RecordingTurnSink();
  const transcript = overrides.transcript ?? new TranscriptBuilder("exec-test", sink.status);

  const deps = {
    // TurnOnDeltaDeps
    sink,
    usagePricer: stubUsagePricer(),
    translator: translatorFor(sink),
    promptEstimatedTokens: 100,
    executionId: "exec-test",
    state,
    // CursorTurnStreamDeps
    transcript,
    eventRecorder: undefined,
    // A tool row's start forces the persist (the builder's flag), so a text-only
    // stream rides this scheduler, which never says yes; markUpdateSent must exist.
    scheduler: { shouldSendUpdate: () => false, markUpdateSent: vi.fn() },
    hitlDir: undefined,
    ...overrides,
  } as unknown as CursorTurnStreamDeps;

  return { deps, state, sink, transcript };
}

/** Every root row the loop folded into the sink's status. */
function rows(sink: RecordingTurnSink) {
  return sink.status.messages.flatMap((m) => m.toolCalls);
}

describe("consumeCursorTurnStream", () => {
  it("folds every event into the sink's status through the translator and the builder, persists live, and returns 'completed' on a natural end", async () => {
    const { deps, state, sink } = buildDeps();

    const reason = await consumeCursorTurnStream(
      mockRun([sdk.assistant("Reading."), sdk.toolCall("c1", "read", "running", { path: "a" }), sdk.toolCall("c1", "read", "completed", { path: "a" }, "text")]),
      deps,
    );

    expect(reason).toBe("completed");
    expect(sink.status.messages.map((m) => [m.content, m.toolCalls.map((tc) => tc.id)])).toEqual([["Reading.", ["c1"]]]);
    expect(rows(sink)[0].result).toBe("text");
    // The #1 retry gap: the bare loop never persisted mid-stream. This proves the
    // shared loop persists live — through the runtime's chokepoint — on the
    // builder's discrete-change flag (a row's start and its finish).
    expect(sink.persistRequests).toBe(2);
    expect(deps.transcript.forceNextUpdate, "the flag is cleared after each persist").toBe(false);
    expect(state.eventCount).toBe(3);
  });

  it("drains the delta channel's queued facts after the stream event, never before it — and the delta's completion instant stands", async () => {
    const { deps, sink } = buildDeps();
    const onDelta = makeCursorTurnOnDelta(deps);
    const withDeltaBetween: StreamableRun = {
      stream: async function* () {
        yield sdk.toolCall("sh-1", "shell", "running", { command: "make" });
        onDelta({ update: { type: "shell-output-delta", event: { callId: "sh-1", type: "stdout", data: "building\n" } } });
        onDelta({ update: { type: "tool-call-completed", callId: "sh-1", modelCallId: "m", toolCall: { type: "shell", args: { command: "make" }, result: { status: "success", value: { exitCode: 0, signal: "", stdout: "building\n", stderr: "", executionTime: 1 } } } } });
        yield sdk.assistant("Built.");
      },
      supports: () => true,
      cancel: async () => {},
    };

    await consumeCursorTurnStream(withDeltaBetween, deps);

    const row = rows(sink)[0];
    expect(row.result, "the output reached the row at the next stream event").toBe("building\n");
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(row.completedAt, "stamped at the delta's observed instant").not.toBe("");
  });

  it("reports progress per event, naming the tool of a tool_call event (the stall copy's `last tool`)", async () => {
    const { deps, sink } = buildDeps();

    await consumeCursorTurnStream(mockRun([sdk.assistant("Go."), sdk.toolCall("c1", "shell", "running", { command: "ls" })]), deps);

    const marks = sink.events.filter((e) => e.kind === "activity");
    expect(marks.map((m) => (m.kind === "activity" ? m.detail : undefined))).toEqual([undefined, "shell"]);
  });

  it("tracks a sub-agent delegation (the 'task' tool call) — dropped by the old bare retry loop", async () => {
    const { deps, sink } = buildDeps();

    await consumeCursorTurnStream(mockRun([sdk.toolCall("t1", "task", "running", { subagentType: "helper", description: "Look", prompt: "Look at it" })]), deps);

    expect(sink.status.subAgentExecutions.map((s) => [s.id, s.name])).toEqual([["t1", "helper"]]);
    expect(rows(sink).map((tc) => tc.id)).toEqual(["t1"]);
  });

  it("captures a stream ERROR status message onto state.streamErrorMessage", async () => {
    const { deps, state } = buildDeps();

    await consumeCursorTurnStream(mockRun([sdk.status("ERROR", "boom")]), deps);

    expect(state.streamErrorMessage).toBe("boom");
  });

  it("does not capture a non-string stream ERROR message (oss#299 hardening)", async () => {
    // message is untyped at runtime; a structured value assigned here would
    // crash classifyText downstream (.toLowerCase() on a non-string).
    const { deps, state } = buildDeps();

    await consumeCursorTurnStream(mockRun([statusWithStructuredMessage()]), deps);

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
      const run = mockRun([sdk.toolCall("c1", "shell", "running", { command: "rm -rf build" })]);

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

      const reason = await consumeCursorTurnStream(mockRun([sdk.toolCall("c1", "shell", "running", { command: "ls" })]), deps);

      expect(reason).toBe("completed");
      expect(state.firstDenialDetected).toBe(false);
    });
  });

  describe("the runtime's stop signal", () => {
    it("a signal aborted before the stream starts: the run is cancelled and nothing is processed", async () => {
      const sink = new RecordingTurnSink();
      sink.abort("cost-cap");
      const { deps } = buildDeps({ sink });
      const run = mockRun([sdk.assistant("never folded")]);

      const reason = await consumeCursorTurnStream(run, deps);

      expect(reason).toBe("interrupted");
      expect(run.cancel).toHaveBeenCalledTimes(1);
      expect(sink.status.messages).toHaveLength(0);
    });

    it("an abort between events: the run is cancelled at once and the next event is never processed", async () => {
      const sink = new RecordingTurnSink();
      const { deps } = buildDeps({ sink });
      // The realistic shape: the runtime aborts (a turn-ended delta crossed the
      // cap, a STOP came back from a persist) while the loop is between events.
      async function* gen(): AsyncIterable<SDKMessage> {
        yield sdk.assistant("first");
        sink.abort("platform-stop");
        yield sdk.assistant(" second");
      }
      const run: MockRun = { stream: () => gen(), supports: () => true, cancel: vi.fn(async () => {}) };

      const reason = await consumeCursorTurnStream(run, deps);

      expect(reason).toBe("interrupted");
      expect(run.cancel).toHaveBeenCalledTimes(1);
      // Event 1 was folded; event 2 hit the boundary check.
      expect(sink.status.messages.map((m) => m.content)).toEqual(["first"]);
    });

    it("an abort while the pull is blocked (a wedged stream): the cancel is what unblocks it", async () => {
      const sink = new RecordingTurnSink();
      const { deps } = buildDeps({ sink });
      // The generator yields one event, then awaits a promise resolved only by
      // run.cancel() — the loop is suspended inside the pull when the runtime's
      // watchdog aborts.
      let unblock: (() => void) | undefined;
      async function* gen(): AsyncIterable<SDKMessage> {
        yield sdk.assistant("first");
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
      const events = [sdk.assistant("first")];
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
        yield sdk.assistant("first");
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
      translator: translatorFor(sink),
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
