import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { streamExecutionV3 } from "../streaming-v3.js";
import type { StreamDependencies } from "../streaming.js";
import type { V3ProtocolEvent } from "../v3-event-recorder.js";

function makeEvent(
  seq: number,
  method: string,
  data: unknown = {},
  opts?: { namespace?: string[]; node?: string },
): V3ProtocolEvent {
  return {
    type: "event",
    seq,
    method,
    params: {
      namespace: opts?.namespace ?? [],
      timestamp: Date.now(),
      node: opts?.node,
      data,
    },
  };
}

function makeToolFinishedEvent(
  seq: number,
  toolName: string,
  filePath: string,
): V3ProtocolEvent {
  return makeEvent(seq, "tools", {
    type: "tool-finished",
    name: toolName,
    input: { path: filePath },
    output: "ok",
  });
}

interface MockRunStream {
  [Symbol.asyncIterator]: () => AsyncGenerator<V3ProtocolEvent>;
  output: Promise<unknown>;
  abort: ReturnType<typeof vi.fn>;
  signal: AbortSignal;
}

function mockV3Run(
  events: V3ProtocolEvent[],
  output?: Record<string, unknown>,
): MockRunStream {
  const outputPromise = output !== undefined
    ? Promise.resolve(output)
    : Promise.reject(new Error("run failed"));
  if (output === undefined) {
    outputPromise.catch(() => {}); // prevent unhandled rejection in test harness
  }
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e;
    },
    output: outputPromise,
    abort: vi.fn(),
    signal: new AbortController().signal,
  };
}

function mockV3Graph(
  events: V3ProtocolEvent[],
  output?: Record<string, unknown>,
) {
  const run = mockV3Run(events, output);
  return {
    streamEvents: vi.fn().mockResolvedValue(run),
    _run: run,
  };
}

function baseDeps(overrides?: Partial<StreamDependencies>): StreamDependencies {
  const graph = mockV3Graph(
    [
      makeEvent(0, "messages", { event: "message-start" }),
      makeEvent(1, "messages", { event: "message-finish" }),
    ],
    { messages: [], structuredResponse: { result: "ok" } },
  );

  return {
    agentGraph: graph,
    langgraphInput: { messages: [{ role: "user", content: "test" }] },
    langgraphConfig: { configurable: { thread_id: "t-1" } },
    executionId: "exec-v3-test",
    client: { updateStatus: vi.fn().mockResolvedValue({ signal: 0 }) } as any,
    initialStatus: create(AgentExecutionStatusSchema, {}),
    streamingConfig: { minIntervalMs: 1, maxIntervalMs: 100, burstThreshold: 1 },
    retryOptions: { delayFn: async () => {} },
    stallTimeoutMs: 60_000,
    streamVersion: "v3",
    ...overrides,
  };
}

describe("streamExecutionV3", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("happy path", () => {
    it("processes all events and returns count", async () => {
      const promise = streamExecutionV3(baseDeps());
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.eventsProcessed).toBe(2);
      expect(result.terminalStatus).toBeUndefined();
    });

    it("returns runOutput from run.output", async () => {
      const promise = streamExecutionV3(baseDeps());
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.runOutput).toEqual({
        messages: [],
        structuredResponse: { result: "ok" },
      });
    });

    it("returns structuredResponse within runOutput", async () => {
      const graph = mockV3Graph(
        [makeEvent(0, "lifecycle", { event: "completed" })],
        { structuredResponse: { name: "Test", score: 42 } },
      );
      const promise = streamExecutionV3(baseDeps({ agentGraph: graph }));
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.runOutput?.structuredResponse).toEqual({ name: "Test", score: 42 });
    });
  });

  describe("call signature", () => {
    it("calls streamEvents with two args (input, config with version and signal)", async () => {
      const graph = mockV3Graph(
        [makeEvent(0, "messages", {})],
        { messages: [] },
      );
      const deps = baseDeps({ agentGraph: graph });
      const promise = streamExecutionV3(deps);
      await vi.runAllTimersAsync();
      await promise;

      expect(graph.streamEvents).toHaveBeenCalledTimes(1);
      const [input, config] = graph.streamEvents.mock.calls[0];
      expect(input).toEqual({ messages: [{ role: "user", content: "test" }] });
      expect(config.version).toBe("v3");
      expect(config.signal).toBeInstanceOf(AbortSignal);
    });

    it("preserves configurable.thread_id in config", async () => {
      const graph = mockV3Graph(
        [makeEvent(0, "messages", {})],
        { messages: [] },
      );
      const deps = baseDeps({ agentGraph: graph });
      const promise = streamExecutionV3(deps);
      await vi.runAllTimersAsync();
      await promise;

      const [, config] = graph.streamEvents.mock.calls[0];
      expect(config.configurable.thread_id).toBe("t-1");
    });
  });

  describe("heartbeat", () => {
    it("fires independently of event arrival via setInterval", async () => {
      vi.useRealTimers();
      const heartbeatFn = vi.fn();

      // Use a slow stream to give the setInterval time to fire
      const slowRun = {
        [Symbol.asyncIterator]: async function* () {
          yield makeEvent(0, "messages", { event: "delta" });
          await new Promise(r => setTimeout(r, 2500));
          yield makeEvent(1, "messages", { event: "delta" });
        },
        output: Promise.resolve({ messages: [] }),
        abort: vi.fn(),
        signal: new AbortController().signal,
      };
      const graph = { streamEvents: vi.fn().mockResolvedValue(slowRun) };

      await streamExecutionV3(baseDeps({ agentGraph: graph, heartbeatFn }));

      // Pre-loop heartbeat + at least one setInterval heartbeat (fires at 2s)
      expect(heartbeatFn.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(heartbeatFn.mock.calls[0][0].phase).toBe("streaming_v3_init");
      vi.useFakeTimers();
    });

    it("does not throw when heartbeatFn throws", async () => {
      const heartbeatFn = vi.fn().mockImplementation(() => {
        throw new Error("heartbeat broken");
      });
      const graph = mockV3Graph(
        [makeEvent(0, "messages", {})],
        { messages: [] },
      );

      const promise = streamExecutionV3(baseDeps({ agentGraph: graph, heartbeatFn }));
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.eventsProcessed).toBe(1);
    });
  });

  describe("cancellation", () => {
    it("calls abort when isCancelledFn returns true", async () => {
      const graph = mockV3Graph(
        [makeEvent(0, "messages", {}), makeEvent(1, "messages", {})],
        { messages: [] },
      );

      let callCount = 0;
      const isCancelledFn = () => {
        callCount++;
        return callCount > 1;
      };

      const promise = streamExecutionV3(baseDeps({ agentGraph: graph, isCancelledFn }));
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.eventsProcessed).toBe(1);
    });

    it("handles run.output rejection after abort gracefully", async () => {
      const outputPromise = Promise.reject(new Error("AbortError"));
      outputPromise.catch(() => {}); // prevent unhandled rejection in test
      const run: MockRunStream = {
        [Symbol.asyncIterator]: async function* () {
          yield makeEvent(0, "messages", {});
        },
        output: outputPromise,
        abort: vi.fn(),
        signal: new AbortController().signal,
      };
      const graph = {
        streamEvents: vi.fn().mockResolvedValue(run),
      };

      const promise = streamExecutionV3(baseDeps({
        agentGraph: graph,
        isCancelledFn: () => true,
      }));
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.runOutput).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("returns result without throwing on GraphRecursionError", async () => {
      const outputPromise = Promise.reject(new Error("failed"));
      outputPromise.catch(() => {}); // prevent unhandled rejection in test
      const graph = {
        streamEvents: vi.fn().mockResolvedValue({
          [Symbol.asyncIterator]: async function* () {
            yield makeEvent(0, "messages", {});
            const err = new Error("Recursion limit reached");
            Object.defineProperty(err, "constructor", {
              value: { name: "GraphRecursionError" },
            });
            throw err;
          },
          output: outputPromise,
          abort: vi.fn(),
          signal: new AbortController().signal,
        }),
      };

      const promise = streamExecutionV3(baseDeps({ agentGraph: graph }));
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.eventsProcessed).toBe(1);
      expect(result.runOutput).toBeUndefined();
    });

    it("propagates non-recursion stream errors", async () => {
      vi.useRealTimers();
      const outputPromise = Promise.reject(new Error("failed"));
      outputPromise.catch(() => {});
      const graph = {
        streamEvents: vi.fn().mockResolvedValue({
          [Symbol.asyncIterator]: async function* () {
            yield makeEvent(0, "messages", {});
            throw new Error("Network failure");
          },
          output: outputPromise,
          abort: vi.fn(),
          signal: new AbortController().signal,
        }),
      };

      await expect(
        streamExecutionV3(baseDeps({ agentGraph: graph })),
      ).rejects.toThrow("Network failure");
      vi.useFakeTimers();
    });

    it("handles run.output rejection gracefully (logged, not thrown)", async () => {
      const graph = mockV3Graph(
        [makeEvent(0, "messages", { event: "message-start" })],
        undefined, // output will reject
      );

      const promise = streamExecutionV3(baseDeps({ agentGraph: graph }));
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.runOutput).toBeUndefined();
      expect(result.eventsProcessed).toBe(1);
    });

    it("throws when stream produces zero events", async () => {
      vi.useRealTimers();
      const graph = mockV3Graph([], { messages: [] });

      await expect(
        streamExecutionV3(baseDeps({ agentGraph: graph })),
      ).rejects.toThrow("Stream completed without processing any events");
      vi.useFakeTimers();
    });
  });

  describe("event recording", () => {
    it("does not create recorder when V3_EVENT_RECORD_DIR is unset", async () => {
      delete process.env.V3_EVENT_RECORD_DIR;
      const promise = streamExecutionV3(baseDeps());
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.eventsProcessed).toBe(2);
    });
  });

  describe("artifact publish on tool-finished", () => {
    it("calls inlinePublisher.publish for file-modifying tools", async () => {
      const publish = vi.fn().mockResolvedValue(undefined);
      const inlinePublisher = { publish } as any;

      const events = [
        makeEvent(0, "messages", { event: "message-start" }),
        makeToolFinishedEvent(1, "write_file", "/ws/app.ts"),
        makeEvent(2, "messages", { event: "message-finish" }),
      ];
      const graph = mockV3Graph(events, { messages: [] });

      const promise = streamExecutionV3(baseDeps({
        agentGraph: graph,
        inlinePublisher,
      }));
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(publish).toHaveBeenCalledWith("/ws/app.ts");
      expect(result.pendingPublishPromises).toHaveLength(1);
    });

    it("does not call publisher for non-file-modifying tools", async () => {
      const publish = vi.fn().mockResolvedValue(undefined);
      const inlinePublisher = { publish } as any;

      const events = [
        makeEvent(0, "tools", {
          type: "tool-finished",
          name: "read_file",
          input: { path: "/ws/file.ts" },
          output: "content",
        }),
      ];
      const graph = mockV3Graph(events, { messages: [] });

      const promise = streamExecutionV3(baseDeps({
        agentGraph: graph,
        inlinePublisher,
      }));
      await vi.runAllTimersAsync();
      await promise;

      expect(publish).not.toHaveBeenCalled();
    });

    it("handles camelCase filePath field", async () => {
      const publish = vi.fn().mockResolvedValue(undefined);
      const inlinePublisher = { publish } as any;

      const events = [
        makeEvent(0, "tools", {
          type: "tool-finished",
          name: "edit_file",
          input: { filePath: "/ws/service.ts" },
        }),
      ];
      const graph = mockV3Graph(events, { messages: [] });

      const promise = streamExecutionV3(baseDeps({
        agentGraph: graph,
        inlinePublisher,
      }));
      await vi.runAllTimersAsync();
      await promise;

      expect(publish).toHaveBeenCalledWith("/ws/service.ts");
    });
  });

  describe("writeback on tool-finished", () => {
    it("calls writebackCoordinator.onFileModified for file-modifying tools", async () => {
      const onFileModified = vi.fn().mockResolvedValue(undefined);
      const writebackCoordinator = { onFileModified } as any;

      const events = [
        makeToolFinishedEvent(0, "edit_file", "/ws/index.ts"),
      ];
      const graph = mockV3Graph(events, { messages: [] });

      const promise = streamExecutionV3(baseDeps({
        agentGraph: graph,
        writebackCoordinator,
      }));
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(onFileModified).toHaveBeenCalledWith("/ws/index.ts");
      expect(result.pendingWritebackPromises).toHaveLength(1);
    });

    it("triggers both publisher and coordinator on same event", async () => {
      const publish = vi.fn().mockResolvedValue(undefined);
      const onFileModified = vi.fn().mockResolvedValue(undefined);

      const events = [
        makeToolFinishedEvent(0, "write_file", "/ws/new.ts"),
      ];
      const graph = mockV3Graph(events, { messages: [] });

      const promise = streamExecutionV3(baseDeps({
        agentGraph: graph,
        inlinePublisher: { publish } as any,
        writebackCoordinator: { onFileModified } as any,
      }));
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(publish).toHaveBeenCalledWith("/ws/new.ts");
      expect(onFileModified).toHaveBeenCalledWith("/ws/new.ts");
      expect(result.pendingPublishPromises).toHaveLength(1);
      expect(result.pendingWritebackPromises).toHaveLength(1);
    });
  });
});
