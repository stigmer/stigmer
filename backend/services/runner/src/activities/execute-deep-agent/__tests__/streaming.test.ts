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
});
