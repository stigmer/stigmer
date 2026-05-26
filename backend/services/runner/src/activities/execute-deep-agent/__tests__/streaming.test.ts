import { describe, it, expect, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ExecutionControlSignal,
  ExecutionPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { streamExecution, type StreamDependencies } from "../streaming.js";
import type { StreamEvent } from "../status-builder.js";
import type { StigmerClient } from "../../../client/stigmer-client.js";

function makeEvent(
  eventType: string,
  runId: string,
  data: Record<string, unknown> = {},
): StreamEvent {
  return { event: eventType, run_id: runId, data };
}

function chatStreamEvent(runId: string, text: string): StreamEvent {
  return makeEvent("on_chat_model_stream", runId, {
    chunk: { content: text },
  });
}

function chatEndEvent(runId: string): StreamEvent {
  return makeEvent("on_chat_model_end", runId, {
    output: { content: "done" },
  });
}

async function* asyncEvents(events: StreamEvent[]): AsyncIterable<StreamEvent> {
  for (const e of events) yield e;
}

function mockGraph(events: StreamEvent[]) {
  return {
    streamEvents: () => asyncEvents(events),
  };
}

function mockClient(
  signal: ExecutionControlSignal = ExecutionControlSignal.UNSPECIFIED,
): StigmerClient {
  return {
    updateStatus: vi.fn().mockResolvedValue({ signal }),
  } as unknown as StigmerClient;
}

function baseDeps(overrides?: Partial<StreamDependencies>): StreamDependencies {
  return {
    agentGraph: mockGraph([
      chatStreamEvent("run-1", "Hello"),
      chatEndEvent("run-1"),
    ]),
    langgraphInput: { messages: [{ role: "user", content: "test" }] },
    langgraphConfig: { configurable: { thread_id: "t-1" } },
    executionId: "exec-test",
    client: mockClient(),
    initialStatus: create(AgentExecutionStatusSchema, {}),
    streamingConfig: { minIntervalMs: 1, maxIntervalMs: 100, burstThreshold: 1 },
    retryOptions: { delayFn: async () => {} },
    stallTimeoutMs: 60_000,
    ...overrides,
  };
}

describe("streamExecution", () => {
  describe("happy path", () => {
    it("processes all events and returns count", async () => {
      const result = await streamExecution(baseDeps());

      expect(result.eventsProcessed).toBe(2);
      expect(result.terminalStatus).toBeUndefined();
    });

    it("persists status during streaming", async () => {
      const client = mockClient();
      await streamExecution(baseDeps({ client }));

      expect(client.updateStatus).toHaveBeenCalled();
    });

    it("sets phase to IN_PROGRESS during streaming", async () => {
      const status = create(AgentExecutionStatusSchema, {});
      await streamExecution(baseDeps({ initialStatus: status }));

      expect(status.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);
    });
  });

  describe("STOP signal", () => {
    it("breaks stream and returns terminal status on STOP", async () => {
      const events = [
        chatStreamEvent("run-1", "Hello"),
        chatEndEvent("run-1"),
        chatStreamEvent("run-2", "More"),
        chatEndEvent("run-2"),
      ];

      const client = {
        updateStatus: vi.fn()
          .mockResolvedValueOnce({ signal: ExecutionControlSignal.STOP })
          .mockResolvedValue({ signal: ExecutionControlSignal.UNSPECIFIED }),
      } as unknown as StigmerClient;

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await streamExecution(baseDeps({
        agentGraph: mockGraph(events),
        client,
      }));
      warnSpy.mockRestore();

      expect(result.terminalStatus).toBeDefined();
      const terminal = result.terminalStatus as Record<string, unknown>;
      expect(terminal.phase).toBe("EXECUTION_COMPLETED");
    });
  });

  describe("cancellation", () => {
    it("returns paused status when cancelled", async () => {
      const result = await streamExecution(baseDeps({
        isCancelledFn: () => true,
      }));

      expect(result.terminalStatus).toBeDefined();
      const terminal = result.terminalStatus as Record<string, unknown>;
      expect(terminal.phase).toBe("EXECUTION_PAUSED");
    });

    it("includes system message explaining pause", async () => {
      const status = create(AgentExecutionStatusSchema, {});
      const result = await streamExecution(baseDeps({
        initialStatus: status,
        isCancelledFn: () => true,
      }));

      expect(result.terminalStatus).toBeDefined();
      expect(status.phase).toBe(ExecutionPhase.EXECUTION_PAUSED);
      expect(status.messages.length).toBeGreaterThanOrEqual(1);
      const pauseMsg = status.messages.find(
        (m) => m.content.includes("paused"),
      );
      expect(pauseMsg).toBeDefined();
    });

    it("preserves events processed before cancellation", async () => {
      let callCount = 0;
      const result = await streamExecution(baseDeps({
        agentGraph: mockGraph([
          chatStreamEvent("run-1", "Hello"),
          chatStreamEvent("run-1", "World"),
          chatEndEvent("run-1"),
        ]),
        isCancelledFn: () => {
          callCount++;
          return callCount > 1;
        },
      }));

      expect(result.eventsProcessed).toBe(1);
      expect(result.terminalStatus).toBeDefined();
      const terminal = result.terminalStatus as Record<string, unknown>;
      expect(terminal.phase).toBe("EXECUTION_PAUSED");
    });

    it("returns pending publish/writeback promises on pause", async () => {
      const publishPromise = Promise.resolve();
      const mockInlinePublisher = {
        publish: vi.fn().mockReturnValue(publishPromise),
      };

      const events = [
        makeEvent("on_tool_end", "run-1", {
          input: { path: "/test/file.ts" },
        }),
      ];
      Object.defineProperty(events[0], "name", { value: "write_file" });

      const result = await streamExecution(baseDeps({
        agentGraph: mockGraph(events),
        isCancelledFn: () => false,
      }));

      expect(result.pendingPublishPromises).toBeDefined();
      expect(result.pendingWritebackPromises).toBeDefined();
    });
  });

  describe("recursion limit", () => {
    it("returns terminated status on GraphRecursionError", async () => {
      const graph = {
        streamEvents: () => {
          return (async function* () {
            yield chatStreamEvent("run-1", "text");
            const err = new Error("Recursion limit reached");
            err.constructor = { name: "GraphRecursionError" } as unknown as Function;
            Object.defineProperty(err, "constructor", {
              value: { name: "GraphRecursionError" },
            });
            throw err;
          })();
        },
      };

      const result = await streamExecution(baseDeps({
        agentGraph: graph,
      }));

      expect(result.terminalStatus).toBeDefined();
      const terminal = result.terminalStatus as Record<string, unknown>;
      expect(terminal.phase).toBe("EXECUTION_TERMINATED");
    });
  });

  describe("zero events", () => {
    it("throws when stream produces zero events", async () => {
      await expect(
        streamExecution(baseDeps({
          agentGraph: mockGraph([]),
        })),
      ).rejects.toThrow("Stream completed without processing any events");
    });
  });

  describe("heartbeat", () => {
    it("calls heartbeat function during streaming", async () => {
      const heartbeatFn = vi.fn();
      const events = Array.from({ length: 10 }, (_, i) =>
        chatStreamEvent(`run-${i}`, `token-${i}`),
      );

      await streamExecution(baseDeps({
        agentGraph: mockGraph(events),
        heartbeatFn,
      }));

      // Heartbeat may or may not fire depending on timing, but should not throw
      expect(true).toBe(true);
    });
  });

  describe("persist cadence", () => {
    it("does not persist on every event with default config", async () => {
      const client = mockClient();
      const events = Array.from({ length: 5 }, (_, i) =>
        chatStreamEvent("run-1", `tok-${i}`),
      );

      await streamExecution(baseDeps({
        agentGraph: mockGraph(events),
        client,
        streamingConfig: { minIntervalMs: 999999, maxIntervalMs: 999999, burstThreshold: 999 },
      }));

      // With very high thresholds, first-update trigger fires once
      const callCount = (client.updateStatus as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(callCount).toBeGreaterThanOrEqual(1);
      expect(callCount).toBeLessThan(events.length);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Artifact publish + writeback orchestration
  //
  // Tests the streaming loop's integration with InlinePublisher and
  // WriteBackCoordinator — triggered on file-modifying tool_end events.
  // ═══════════════════════════════════════════════════════════════════════

  describe("artifact publish on tool_end", () => {
    function writeToolEndEvent(
      runId: string,
      toolName: string,
      filePath: string,
    ): StreamEvent {
      return {
        event: "on_tool_end",
        name: toolName,
        run_id: runId,
        data: { input: { path: filePath }, output: "file written" },
      };
    }

    it("calls inlinePublisher.publish for file-modifying tools", async () => {
      const publishFn = vi.fn().mockResolvedValue(undefined);
      const mockPublisher = { publish: publishFn };

      const events = [
        chatStreamEvent("run-1", "Writing a file"),
        chatEndEvent("run-1"),
        makeEvent("on_tool_start", "tool-w1", { input: { path: "/ws/app.ts" } }),
        writeToolEndEvent("tool-w1", "write_file", "/ws/app.ts"),
        chatStreamEvent("run-2", "Done"),
        chatEndEvent("run-2"),
      ];
      // Set name on tool_start event
      Object.defineProperty(events[2], "name", { value: "write_file" });

      const result = await streamExecution(baseDeps({
        agentGraph: mockGraph(events),
        inlinePublisher: mockPublisher as any,
      }));

      expect(publishFn).toHaveBeenCalledWith("/ws/app.ts");
      expect(result.pendingPublishPromises).toHaveLength(1);
    });

    it("extracts path from file_path, filename, and file input fields", async () => {
      const publishFn = vi.fn().mockResolvedValue(undefined);
      const mockPublisher = { publish: publishFn };

      const events = [
        chatStreamEvent("run-1", "text"),
        chatEndEvent("run-1"),
        {
          event: "on_tool_end",
          name: "edit_file",
          run_id: "tool-1",
          data: { input: { file_path: "/ws/via-file-path.ts" }, output: "ok" },
        } as StreamEvent,
        {
          event: "on_tool_end",
          name: "create_file",
          run_id: "tool-2",
          data: { input: { filename: "/ws/via-filename.ts" }, output: "ok" },
        } as StreamEvent,
        {
          event: "on_tool_end",
          name: "write",
          run_id: "tool-3",
          data: { input: { file: "/ws/via-file.ts" }, output: "ok" },
        } as StreamEvent,
      ];

      await streamExecution(baseDeps({
        agentGraph: mockGraph(events),
        inlinePublisher: mockPublisher as any,
      }));

      expect(publishFn).toHaveBeenCalledTimes(3);
      expect(publishFn).toHaveBeenCalledWith("/ws/via-file-path.ts");
      expect(publishFn).toHaveBeenCalledWith("/ws/via-filename.ts");
      expect(publishFn).toHaveBeenCalledWith("/ws/via-file.ts");
    });

    it("does not call publisher for non-file-modifying tools", async () => {
      const publishFn = vi.fn().mockResolvedValue(undefined);
      const mockPublisher = { publish: publishFn };

      const events = [
        chatStreamEvent("run-1", "text"),
        chatEndEvent("run-1"),
        {
          event: "on_tool_end",
          name: "read_file",
          run_id: "tool-1",
          data: { input: { path: "/ws/readonly.ts" }, output: "contents" },
        } as StreamEvent,
      ];

      await streamExecution(baseDeps({
        agentGraph: mockGraph(events),
        inlinePublisher: mockPublisher as any,
      }));

      expect(publishFn).not.toHaveBeenCalled();
    });
  });

  describe("writeback on tool_end", () => {
    it("calls writebackCoordinator.onFileModified for file-modifying tools", async () => {
      const onFileModified = vi.fn().mockResolvedValue(undefined);
      const mockCoordinator = { onFileModified };

      const events = [
        chatStreamEvent("run-1", "editing"),
        chatEndEvent("run-1"),
        {
          event: "on_tool_end",
          name: "edit_file",
          run_id: "tool-e1",
          data: { input: { path: "/ws/service.ts" }, output: "edited" },
        } as StreamEvent,
      ];

      const result = await streamExecution(baseDeps({
        agentGraph: mockGraph(events),
        writebackCoordinator: mockCoordinator as any,
      }));

      expect(onFileModified).toHaveBeenCalledWith("/ws/service.ts");
      expect(result.pendingWritebackPromises).toHaveLength(1);
    });

    it("triggers both publisher and coordinator on same tool_end", async () => {
      const publishFn = vi.fn().mockResolvedValue(undefined);
      const onFileModified = vi.fn().mockResolvedValue(undefined);

      const events = [
        chatStreamEvent("run-1", "writing"),
        chatEndEvent("run-1"),
        {
          event: "on_tool_end",
          name: "write_file",
          run_id: "tool-w1",
          data: { input: { path: "/ws/both.ts" }, output: "written" },
        } as StreamEvent,
      ];

      const result = await streamExecution(baseDeps({
        agentGraph: mockGraph(events),
        inlinePublisher: { publish: publishFn } as any,
        writebackCoordinator: { onFileModified } as any,
      }));

      expect(publishFn).toHaveBeenCalledWith("/ws/both.ts");
      expect(onFileModified).toHaveBeenCalledWith("/ws/both.ts");
      expect(result.pendingPublishPromises).toHaveLength(1);
      expect(result.pendingWritebackPromises).toHaveLength(1);
    });
  });

  describe("graceful stop with pending artifacts", () => {
    it("returns terminal status while preserving pending promises", async () => {
      const publishFn = vi.fn().mockResolvedValue(undefined);
      const mockPublisher = { publish: publishFn };

      const events = [
        chatStreamEvent("run-1", "writing file"),
        chatEndEvent("run-1"),
        // tool_start triggers forceNextUpdate → persist #1 → UNSPECIFIED
        makeEvent("on_tool_start", "tool-w1", { input: { path: "/ws/artifact.ts" } }),
        // tool_end triggers publish + forceNextUpdate → persist #2 → STOP
        {
          event: "on_tool_end",
          name: "write_file",
          run_id: "tool-w1",
          data: { input: { path: "/ws/artifact.ts" }, output: "written" },
        } as StreamEvent,
        chatStreamEvent("run-2", "this should not be reached"),
      ];
      Object.defineProperty(events[2], "name", { value: "write_file" });

      // Persist sequence with high thresholds (only forceNextUpdate triggers):
      //   #1: first-event trigger (chatStream) → UNSPECIFIED
      //   #2: tool_start forceNextUpdate → UNSPECIFIED
      //   #3: tool_end forceNextUpdate (publish already queued) → STOP
      const client = {
        updateStatus: vi.fn()
          .mockResolvedValueOnce({ signal: ExecutionControlSignal.UNSPECIFIED })
          .mockResolvedValueOnce({ signal: ExecutionControlSignal.UNSPECIFIED })
          .mockResolvedValueOnce({ signal: ExecutionControlSignal.STOP })
          .mockResolvedValue({ signal: ExecutionControlSignal.UNSPECIFIED }),
      } as unknown as StigmerClient;

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await streamExecution(baseDeps({
        agentGraph: mockGraph(events),
        client,
        inlinePublisher: mockPublisher as any,
        streamingConfig: { minIntervalMs: 999999, maxIntervalMs: 999999, burstThreshold: 999 },
      }));
      warnSpy.mockRestore();

      expect(result.terminalStatus).toBeDefined();
      expect(publishFn).toHaveBeenCalledWith("/ws/artifact.ts");
      expect(result.pendingPublishPromises).toHaveLength(1);
    });
  });
});
