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

function makeToolStartedEvent(
  seq: number,
  toolName: string,
  input: Record<string, unknown>,
): V3ProtocolEvent {
  return makeEvent(seq, "tools", {
    event: "tool-started",
    tool_call_id: `toolu_${seq}`,
    tool_name: toolName,
    input,
  }, { namespace: [`tools:toolu_${seq}`] });
}

function makeToolFinishedEvent(
  seq: number,
  callId: string,
): V3ProtocolEvent {
  return makeEvent(seq, "tools", {
    event: "tool-finished",
    tool_call_id: callId,
    output: { lc: 1, type: "constructor", id: ["langchain_core", "messages", "ToolMessage"], kwargs: { content: "ok", tool_call_id: callId } },
  }, { namespace: [`tools:${callId}`] });
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
      expect(heartbeatFn.mock.calls[0][0].phase).toBeDefined();
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

    it("returns paused terminal status on cancellation", async () => {
      const graph = mockV3Graph(
        [makeEvent(0, "messages", { event: "message-start" }), makeEvent(1, "messages", { event: "message-finish" })],
        { messages: [] },
      );

      const promise = streamExecutionV3(baseDeps({
        agentGraph: graph,
        isCancelledFn: () => true,
      }));
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.terminalStatus).toBeDefined();
      expect(result.runOutput).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("returns terminated status on GraphRecursionError", async () => {
      const outputPromise = Promise.reject(new Error("failed"));
      outputPromise.catch(() => {});
      const graph = {
        streamEvents: vi.fn().mockResolvedValue({
          [Symbol.asyncIterator]: async function* () {
            yield makeEvent(0, "messages", { event: "message-start" });
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
      expect(result.terminalStatus).toBeDefined();
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

  describe("artifact publish via ToolInputCache", () => {
    it("calls inlinePublisher.publish for file-modifying tools (started → finished)", async () => {
      const publish = vi.fn().mockResolvedValue(undefined);
      const inlinePublisher = { publish } as any;

      const events = [
        makeEvent(0, "messages", { event: "message-start" }),
        makeToolStartedEvent(1, "write_file", { path: "/ws/app.ts" }),
        makeToolFinishedEvent(2, "toolu_1"),
        makeEvent(3, "messages", { event: "message-finish" }),
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
        makeToolStartedEvent(0, "read_file", { path: "/ws/file.ts" }),
        makeToolFinishedEvent(1, "toolu_0"),
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

    it("handles camelCase filePath field in tool input", async () => {
      const publish = vi.fn().mockResolvedValue(undefined);
      const inlinePublisher = { publish } as any;

      const events = [
        makeToolStartedEvent(0, "edit_file", { filePath: "/ws/service.ts" }),
        makeToolFinishedEvent(1, "toolu_0"),
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

  describe("writeback via ToolInputCache", () => {
    it("calls writebackCoordinator.onFileModified for file-modifying tools", async () => {
      const onFileModified = vi.fn().mockResolvedValue(undefined);
      const writebackCoordinator = { onFileModified } as any;

      const events = [
        makeToolStartedEvent(0, "edit_file", { path: "/ws/index.ts" }),
        makeToolFinishedEvent(1, "toolu_0"),
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

    it("triggers both publisher and coordinator on same tool", async () => {
      const publish = vi.fn().mockResolvedValue(undefined);
      const onFileModified = vi.fn().mockResolvedValue(undefined);

      const events = [
        makeToolStartedEvent(0, "write_file", { path: "/ws/new.ts" }),
        makeToolFinishedEvent(1, "toolu_0"),
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

  describe("orchestration parity", () => {
    it("persists status during streaming via scheduler", async () => {
      const updateStatus = vi.fn().mockResolvedValue({ signal: 0 });
      const client = { updateStatus } as any;

      const events = [
        makeEvent(0, "messages", { event: "message-start", run_id: "r1" }),
        makeEvent(1, "messages", { event: "content-block-delta", index: 0, delta: { type: "text-delta", text: "hi" }, run_id: "r1" }),
        makeEvent(2, "messages", { event: "message-finish", run_id: "r1" }),
      ];
      const graph = mockV3Graph(events, { messages: [] });

      const promise = streamExecutionV3(baseDeps({ agentGraph: graph, client }));
      await vi.runAllTimersAsync();
      await promise;

      expect(updateStatus).toHaveBeenCalled();
    });

    it("breaks stream and returns terminal status on STOP signal", async () => {
      const updateStatus = vi.fn()
        .mockResolvedValueOnce({ signal: 1 }); // ExecutionControlSignal.STOP = 1
      const client = { updateStatus } as any;

      const events = [
        makeEvent(0, "messages", { event: "message-start", run_id: "r1" }),
        makeEvent(1, "messages", { event: "content-block-delta", index: 0, delta: { type: "text-delta", text: "hi" }, run_id: "r1" }),
        makeEvent(2, "messages", { event: "message-finish", run_id: "r1" }),
        makeEvent(3, "messages", { event: "message-start", run_id: "r2" }),
      ];
      const graph = mockV3Graph(events, { messages: [] });

      const promise = streamExecutionV3(baseDeps({ agentGraph: graph, client }));
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.terminalStatus).toBeDefined();
    });

    it("feeds events through normalizer into V3StatusBuilder (messages appear on status)", async () => {
      const events = [
        makeEvent(0, "messages", { event: "message-start", run_id: "r1" }),
        makeEvent(1, "messages", { event: "content-block-delta", index: 0, delta: { type: "text-delta", text: "Hello world" }, run_id: "r1" }),
        makeEvent(2, "messages", { event: "message-finish", run_id: "r1", usage: { input_tokens: 10, output_tokens: 5 } }),
      ];
      const graph = mockV3Graph(events, { messages: [] });
      const status = create(AgentExecutionStatusSchema, {});

      const promise = streamExecutionV3(baseDeps({ agentGraph: graph, initialStatus: status }));
      await vi.runAllTimersAsync();
      await promise;

      expect(status.messages.length).toBeGreaterThanOrEqual(1);
      expect(status.messages[0].content).toBe("Hello world");
      expect(status.streamingUsage).toBeDefined();
      expect(status.streamingUsage!.inputTokens).toBe(10n);
    });
  });

  describe("image offload through the persist chokepoint", () => {
    it("offloads an MCP image tool result to a renderable ToolCallOutputRef", async () => {
      // End-to-end: a tool returns image content blocks; the builder stores them
      // faithfully (no truncation), and the persist chokepoint offloads the image
      // to artifact storage so the persisted ToolCall carries outputRef.isImage.
      const uploads: { key: string; size: number; contentType?: string }[] = [];
      const artifactStorage = {
        upload: vi.fn(async (key: string, content: Buffer, contentType?: string) => {
          uploads.push({ key, size: content.length, contentType });
          return key;
        }),
        getDownloadUrl: vi.fn(async (key: string) => `https://artifacts.local/${key}`),
        exists: vi.fn(async () => true),
      } as any;

      const base64 = Buffer.from("PNGBYTES".repeat(64)).toString("base64");
      const imageEnvelope = {
        lc: 1,
        type: "constructor",
        id: ["langchain_core", "messages", "ToolMessage"],
        kwargs: {
          status: "success",
          content: [{ type: "image", data: base64, mimeType: "image/png" }],
          tool_call_id: "toolu_1",
        },
      };

      const events = [
        makeEvent(0, "messages", { event: "message-start", run_id: "r1" }),
        makeToolStartedEvent(1, "screenshot", {}),
        makeEvent(2, "tools", {
          event: "tool-finished",
          tool_call_id: "toolu_1",
          output: imageEnvelope,
        }, { namespace: ["tools:toolu_1"] }),
        makeEvent(3, "messages", { event: "message-finish", run_id: "r1" }),
      ];
      const graph = mockV3Graph(events, { messages: [] });

      const persisted: any[] = [];
      const updateStatus = vi.fn(async (_id: string, status: any) => {
        persisted.push(status);
        return { signal: 0 };
      });

      const promise = streamExecutionV3(baseDeps({
        agentGraph: graph,
        client: { updateStatus } as any,
        offload: { artifactStorage, executionId: "exec-v3-test" },
      }));
      await vi.runAllTimersAsync();
      await promise;

      // Find a persisted snapshot whose tool call carries the image ref.
      const refTc = persisted
        .flatMap((s) => s.messages)
        .flatMap((m: any) => m.toolCalls)
        .find((tc: any) => tc?.id === "toolu_1" && tc?.outputRef);

      expect(refTc).toBeDefined();
      expect(refTc.outputRef.isImage).toBe(true);
      expect(refTc.outputRef.mimeType).toBe("image/png");
      expect(refTc.outputRef.storageKey).toBe("artifacts/exec-v3-test/toolcalls/toolu_1.png");
      // The base64 must not survive inline on the persisted result.
      expect(refTc.result).not.toContain(base64);
      expect(uploads).toHaveLength(1);
      expect(uploads[0].contentType).toBe("image/png");
    });
  });
});
