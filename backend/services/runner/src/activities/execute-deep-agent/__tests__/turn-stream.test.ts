/**
 * The native adapter's stream loop (`turn-stream.ts` `consumeDeepAgentStream`)
 * over a SCRIPTED v3 run and the kit's recording sink — no graph, no model,
 * no runtime. What the hermetic goldens prove end to end, this file pins one
 * rule at a time, where a failure names the rule:
 *
 *  - how the graph is invoked (the two-arg v3 `streamEvents` shape, the
 *    runtime's `langgraphConfig` carried whole, the loop's own abort signal);
 *  - what each event becomes (the normalizer feeds the builder; the sink
 *    learns of activity per event, with the tool's name as the detail);
 *  - what the sink is told and when (usage priced per `message_finish`;
 *    a persist requested on the shared cadence rule, a tool start forcing it);
 *  - how the loop ends: `completed` with the run's output, `awaiting_approval`
 *    at a gate, `interrupted` when the runtime stops it — taken at the NEXT
 *    event, the engine's own step boundary (S3 M2a F-M2a-18), and before the
 *    first if the stop came earlier;
 *  - what it refuses and what it tolerates: an empty stream throws; the
 *    engine's own error propagates; a `run.output` that rejects is logged
 *    and the turn completes without a final state;
 *  - the recorder exists only under `V3_EVENT_RECORD_DIR`.
 *
 * Carried from the legacy v3 loop's suite (`streaming-v3.test.ts`, retired
 * with the loop at S3 M2b, Q-M2b-5): the arms whose rule the adapter's loop
 * still has, re-stated against the sink. The loop-specific arms it dropped
 * (the in-band heartbeat timer, the 120 s stall, STOP read from the persist,
 * pause as a terminal status) are the turn runtime's now and pinned in
 * `harness/__tests__` and the hermetic goldens.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemorySaver } from "@langchain/langgraph";
import { MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { RecordingTurnSink } from "../../../__test-utils__/harness-contract/recording-sink.js";
import { makeInMemoryArtifactStorage } from "../../../__test-utils__/fake-artifact-storage.js";
import { turnInputFixture } from "../../../__test-utils__/turn-input-fixture.js";
import type { WorkspaceBackend } from "../../../shared/workspace/types.js";
import type { ModelPricing } from "../../../shared/model-pricing.js";
import type { MergedToolPolicy } from "../../../shared/approval-policy.js";
import { CasCaptureObserver } from "../cas-capture-observer.js";
import type { DeepAgentEngine, DeepAgentGateState, DeepAgentGraphInput, DeepAgentWorkspace } from "../turn-setup.js";
import { consumeDeepAgentStream, createDeepAgentTranscript, type StreamableRun } from "../turn-stream.js";
import type { V3ProtocolEvent } from "../v3-event-recorder.js";
import {
  makeMessageFinish,
  makeMessageStart,
  makeTextDelta,
  makeToolFinished,
  makeToolStarted,
  resetSeq,
} from "../__test-utils__/v3-event-fixtures.js";

const PRICING: ModelPricing = {
  model: "claude-haiku-4.5",
  displayName: "Haiku (test)",
  costTier: "standard",
  inputPricePerMillion: 1.0,
  outputPricePerMillion: 5.0,
  cacheWritePricePerMillion: 1.25,
  cacheReadPricePerMillion: 0.1,
};

function openGate(overrides: Partial<DeepAgentGateState> = {}): DeepAgentGateState {
  return {
    policies: new Map(),
    toolServerMap: new Map(),
    leasedCategories: new Set(),
    globalBypass: false,
    unattended: false,
    unattendedSkips: new Set(),
    ...overrides,
  };
}

/** A workspace whose files are the given map; the publisher reads through it. */
function workspaceOver(files: Record<string, string>): DeepAgentWorkspace {
  const backend: WorkspaceBackend = {
    rootDir: "/workspace",
    execute: vi.fn(async () => ""),
    readFile: vi.fn(async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return content;
    }),
    writeFile: vi.fn(async () => undefined),
    writeFileBuffer: vi.fn(async () => undefined),
    exists: vi.fn(async (path: string) => path in files),
  };
  return {
    backend,
    casObserver: new CasCaptureObserver({ rootDir: "/workspace", isIgnored: async () => false }),
    isCapturablePath: async () => false,
  };
}

interface ScriptedRunOptions {
  /** The final state `run.output` resolves to; a function so a rejection is created when the run is. */
  readonly output?: () => Promise<unknown>;
  /** Called between events, after the event at this index was yielded and before the next is. */
  readonly between?: (yielded: number) => void;
  /** Thrown from the stream after this many events. */
  readonly failAfter?: number;
}

/** A `StreamableRun` over scripted events; what the graph would hand the loop. */
function scriptedRun(events: readonly V3ProtocolEvent[], options: ScriptedRunOptions = {}): StreamableRun {
  const output = options.output ? options.output() : Promise.resolve({ messages: [] });
  const iterate = async function* (): AsyncGenerator<V3ProtocolEvent> {
    let yielded = 0;
    for (const event of events) {
      if (options.failAfter !== undefined && yielded === options.failAfter) throw new Error("engine exploded mid-stream");
      yield event;
      yielded++;
      options.between?.(yielded);
    }
    if (options.failAfter !== undefined && yielded === options.failAfter) throw new Error("engine exploded mid-stream");
  };
  return { output, [Symbol.asyncIterator]: iterate };
}

interface Harness {
  readonly sink: RecordingTurnSink;
  readonly engine: DeepAgentEngine;
  readonly streamEvents: ReturnType<typeof vi.fn>;
  readonly blobs: Map<string, Buffer>;
  run(run: StreamableRun): ReturnType<typeof consumeDeepAgentStream>;
}

function harness(options: { gate?: DeepAgentGateState; files?: Record<string, string> } = {}): Harness {
  // Artifact storage is part of the turn's input; the publisher uploads there
  // and registers the artifact on the status, or does nothing at all without it.
  const { storage, blobs } = makeInMemoryArtifactStorage();
  const input = turnInputFixture({ message: "Say hello.", artifactStorage: storage });
  const sink = new RecordingTurnSink();
  const streamEvents = vi.fn();
  const engine: DeepAgentEngine = {
    graph: { streamEvents },
    checkpointer: new MemorySaver(),
    langgraphConfig: { configurable: { thread_id: "thread-fixture" }, recursionLimit: 40 },
    modelName: PRICING.model,
    pricing: PRICING,
    gate: options.gate ?? openGate(),
    hasStructuredOutput: false,
  };
  const workspace = workspaceOver(options.files ?? {});
  const graphInput: DeepAgentGraphInput = { kind: "message", input: { messages: [{ role: "user", content: "Say hello." }] } };
  return {
    sink,
    engine,
    streamEvents,
    blobs,
    run(run) {
      streamEvents.mockResolvedValue(run);
      const transcript = createDeepAgentTranscript(input, sink, engine, workspace);
      return consumeDeepAgentStream({ input, sink, engine, graphInput, transcript });
    },
  };
}

/** One text turn with usage, as the graph streams it. */
function textTurn(runId: string, text: string, usage = { input_tokens: 100, output_tokens: 20 }): V3ProtocolEvent[] {
  return [makeMessageStart(runId), makeTextDelta(runId, text), makeMessageFinish(runId, { usage })];
}

beforeEach(() => resetSeq());
afterEach(() => vi.unstubAllEnvs());

describe("consumeDeepAgentStream — how the graph is invoked", () => {
  it("calls streamEvents with the graph input and the runtime's config plus version v3 and its own abort signal", async () => {
    const h = harness();
    await h.run(scriptedRun(textTurn("run-1", "Hello.")));

    expect(h.streamEvents).toHaveBeenCalledTimes(1);
    const [input, config] = h.streamEvents.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(input).toEqual({ messages: [{ role: "user", content: "Say hello." }] });
    expect(config.version).toBe("v3");
    expect(config.configurable, "the runtime's thread id rides the config whole").toEqual({ thread_id: "thread-fixture" });
    expect(config.recursionLimit).toBe(40);
    expect(config.signal).toBeInstanceOf(AbortSignal);
    expect((config.signal as AbortSignal).aborted, "a completed run was never aborted").toBe(false);
  });
});

describe("consumeDeepAgentStream — what each event becomes", () => {
  it("feeds every event through the normalizer into the transcript and completes with the run's output", async () => {
    const h = harness();
    const result = await h.run(
      scriptedRun(
        [...textTurn("run-1", "Reading the file."), makeToolStarted("toolu_1", "read_file", { path: "/x" }), makeToolFinished("toolu_1", "contents")],
        { output: () => Promise.resolve({ messages: [], structuredResponse: { ok: true } }) },
      ),
    );

    expect(result.reason).toBe("completed");
    expect(result.eventsProcessed).toBe(5);
    expect(result.runOutput?.structuredResponse).toEqual({ ok: true });
    const [message] = h.sink.status.messages;
    expect(message.type).toBe(MessageType.MESSAGE_AI);
    expect(message.content).toBe("Reading the file.");
    expect(message.toolCalls[0].name).toBe("read_file");
    expect(message.toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
  });

  it("tells the sink of activity once per event, naming the tool a tool_started carries", async () => {
    const h = harness();
    await h.run(scriptedRun([...textTurn("run-1", "x"), makeToolStarted("toolu_1", "read_file", { path: "/x" }), makeToolFinished("toolu_1", "ok")]));

    const details = h.sink.events.flatMap((e) => (e.kind === "activity" ? [e.detail] : []));
    // One mark after the run starts, one per event (5), one after the output resolved.
    expect(details).toHaveLength(7);
    expect(details.filter((d) => d === "read_file"), "the tool's name is the stall watchdog's last detail").toHaveLength(1);
  });

  it("reports usage per message_finish, priced at the engine's rates for the engine's model", async () => {
    const h = harness();
    await h.run(
      scriptedRun([
        ...textTurn("run-1", "one", { input_tokens: 1_000, output_tokens: 100 }),
        ...textTurn("run-2", "two", { input_tokens: 2_000, output_tokens: 200 }),
      ]),
    );

    const deltas = h.sink.usageDeltas;
    expect(deltas).toHaveLength(2);
    expect(deltas[0]).toMatchObject({ inputTokens: 1_000, outputTokens: 100, model: PRICING.model });
    // 1,000 in at $1/M + 100 out at $5/M.
    expect(deltas[0].estimatedCostUsd).toBeCloseTo(0.0015, 10);
    expect(deltas[1].estimatedCostUsd).toBeCloseTo(0.003, 10);
  });

  it("requests a persist on the shared cadence rule — a tool start forces one — and clears the force flag", async () => {
    const h = harness();
    await h.run(scriptedRun([...textTurn("run-1", "x"), makeToolStarted("toolu_1", "read_file", { path: "/x" }), makeToolFinished("toolu_1", "ok")]));

    expect(h.sink.persistRequests, "the tool start and the tool finish each force a persist").toBeGreaterThanOrEqual(2);
    const order = h.sink.events.map((e) => e.kind);
    expect(order.indexOf("persist"), "the first persist follows the events that forced it, never precedes them").toBeGreaterThan(0);
  });

  it("publishes a file-modifying tool's target as an artifact on the status when the call finishes", async () => {
    const h = harness({ files: { "src/main.ts": "console.log('hi');" } });
    const result = await h.run(
      scriptedRun([
        ...textTurn("run-1", "Writing."),
        makeToolStarted("toolu_w", "write_file", { file_path: "src/main.ts", content: "console.log('hi');" }),
        makeToolFinished("toolu_w", "written"),
      ]),
    );

    expect(result.pendingPublishPromises, "one publish fired mid-turn, for the settle to drain").toHaveLength(1);
    await Promise.all(result.pendingPublishPromises);
    expect(h.sink.status.artifacts.map((a) => a.sandboxPath)).toEqual(["src/main.ts"]);
    expect([...h.blobs.keys()], "the bytes were uploaded under the execution's artifact key").toEqual(["artifacts/aex_fixture_0001/main.ts"]);
  });
});

describe("consumeDeepAgentStream — how the loop ends", () => {
  it("ends awaiting_approval when the builder leaves a gated tool WAITING, without awaiting the run's output", async () => {
    const policy: MergedToolPolicy = {
      toolName: "dangerous_tool",
      mcpServerSlug: "my-server",
      requiresApproval: true,
      approvalMessage: "Approve?",
      source: "classifier_default",
    };
    const h = harness({
      gate: openGate({ policies: new Map([["my-server/dangerous_tool", policy]]), toolServerMap: new Map([["dangerous_tool", "my-server"]]) }),
    });
    const neverResolves = new Promise<unknown>(() => undefined);
    const result = await h.run(
      scriptedRun([...textTurn("run-1", "Gated."), makeToolStarted("toolu_g", "dangerous_tool", { target: "prod" })], { output: () => neverResolves }),
    );

    expect(result.reason).toBe("awaiting_approval");
    expect(result.runOutput).toBeUndefined();
    expect(h.sink.status.messages[0].toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
  });

  it("a stop before the first event settles interrupted without invoking the graph", async () => {
    const h = harness();
    h.sink.abort("stopped before start");
    const result = await h.run(scriptedRun(textTurn("run-1", "never")));

    expect(result.reason).toBe("interrupted");
    expect(result.eventsProcessed).toBe(0);
    expect(h.streamEvents).not.toHaveBeenCalled();
  });

  it("a stop mid-stream is taken at the NEXT event: the events before it count, the run's signal is aborted", async () => {
    const h = harness();
    const [start, delta, finish] = textTurn("run-1", "partial");
    const result = await h.run(scriptedRun([start, delta, finish], { between: (yielded) => { if (yielded === 2) h.sink.abort("runtime stop"); } }));

    expect(result.reason).toBe("interrupted");
    expect(result.eventsProcessed, "start and delta were folded; finish arrived after the stop").toBe(2);
    const [, config] = h.streamEvents.mock.calls[0] as [unknown, { signal: AbortSignal }];
    expect(config.signal.aborted, "the graph run itself is aborted when the stop is taken").toBe(true);
    expect(h.sink.status.messages[0].content, "what streamed before the stop is on the transcript").toBe("partial");
  });

  it("the engine's own error propagates when the runtime did not stop the turn", async () => {
    const h = harness();
    await expect(h.run(scriptedRun(textTurn("run-1", "x"), { failAfter: 1 }))).rejects.toThrow("engine exploded mid-stream");
  });

  it("an error thrown after the runtime stopped the turn is the stop, not a failure", async () => {
    const h = harness();
    const result = await h.run(
      scriptedRun(textTurn("run-1", "x"), { between: (yielded) => { if (yielded === 1) h.sink.abort("runtime stop"); }, failAfter: 1 }),
    );
    expect(result.reason).toBe("interrupted");
  });

  it("refuses a stream that produced no events", async () => {
    const h = harness();
    await expect(h.run(scriptedRun([]))).rejects.toThrow(/Stream completed without processing any events/);
  });

  it("a run.output that rejects is logged and the turn completes without a final state", async () => {
    const h = harness();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const result = await h.run(scriptedRun(textTurn("run-1", "x"), { output: () => Promise.reject(new Error("state never settled")) }));
      expect(result.reason).toBe("completed");
      expect(result.runOutput).toBeUndefined();
      expect(warn.mock.calls.some((c) => String(c[0]).includes("run.output rejected"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  // Regression pins for stigmer#1008 (carried from the orchestrator's
  // `streaming-v3.test.ts`, retired with its module; the fix on that module
  // was stigmer#1092). The run.output bound must not leave its timer armed:
  // a referenced timer holds the runner's event loop open after its worker
  // has stopped, for the full Kubernetes termination grace. Faked timers
  // here so `vi.getTimerCount()` can see what the loop left behind.
  describe("the run.output bound leaves nothing armed", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("once run.output has resolved", async () => {
      const h = harness();
      const promise = h.run(scriptedRun(textTurn("run-1", "x")));
      // Well short of the 30 s bound: a leaked timer would still be pending here.
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await promise;
      expect(result.runOutput).toBeDefined();
      expect(vi.getTimerCount(), "the loop left a timer armed after completion").toBe(0);
    });

    it("when run.output never settles: the bound ends the wait, no final state, nothing armed", async () => {
      const h = harness();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        const promise = h.run(scriptedRun(textTurn("run-1", "x"), { output: () => new Promise(() => undefined) }));
        await vi.advanceTimersByTimeAsync(30_000);
        const result = await promise;
        expect(result.reason).toBe("completed");
        expect(result.runOutput).toBeUndefined();
        expect(warn.mock.calls.some((c) => String(c[0]).includes("run.output did not resolve within 30000ms"))).toBe(true);
        expect(vi.getTimerCount(), "the bound's own timer is cleared on expiry").toBe(0);
      } finally {
        warn.mockRestore();
      }
    });
  });
});

describe("consumeDeepAgentStream — the event recorder", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "v3-events-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("records nothing unless V3_EVENT_RECORD_DIR is set", async () => {
    vi.stubEnv("V3_EVENT_RECORD_DIR", "");
    const h = harness();
    await h.run(scriptedRun(textTurn("run-1", "x")));
    expect(readdirSync(dir)).toEqual([]);
  });

  it("records every raw event to <dir>/<executionId>.v3-events.json and flushes it when the stream ends", async () => {
    vi.stubEnv("V3_EVENT_RECORD_DIR", dir);
    const h = harness();
    await h.run(scriptedRun(textTurn("run-1", "x")));
    expect(existsSync(join(dir, "aex_fixture_0001.v3-events.json"))).toBe(true);
  });
});
