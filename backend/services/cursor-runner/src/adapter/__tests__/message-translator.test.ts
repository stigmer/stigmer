import { describe, it, expect } from "vitest";
import { MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SDKMessage } from "@cursor/sdk";
import {
  translateEvent,
  extractDeniedToolCalls,
  utcTimestamp,
  MessageAccumulator,
} from "../message-translator.js";

describe("utcTimestamp", () => {
  it("returns a valid ISO 8601 timestamp ending in Z", () => {
    const ts = utcTimestamp();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("returns different values across calls", async () => {
    const ts1 = utcTimestamp();
    await new Promise((r) => setTimeout(r, 5));
    const ts2 = utcTimestamp();
    expect(ts1).not.toBe(ts2);
  });
});

describe("translateEvent", () => {
  describe("assistant events", () => {
    it("translates an assistant message with text blocks", () => {
      const event = {
        type: "assistant" as const,
        message: {
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world" },
          ],
        },
      } as SDKMessage;

      const messages = translateEvent(event);
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe(MessageType.MESSAGE_AI);
      expect(messages[0].content).toBe("Hello world");
      expect(messages[0].timestamp).toMatch(/Z$/);
    });

    it("filters non-text content blocks", () => {
      const event = {
        type: "assistant" as const,
        message: {
          content: [
            { type: "text", text: "code" },
            { type: "image", url: "http://img" },
          ],
        },
      } as SDKMessage;

      const messages = translateEvent(event);
      expect(messages[0].content).toBe("code");
    });
  });

  describe("thinking events", () => {
    it("translates a thinking event", () => {
      const event = {
        type: "thinking" as const,
        text: "Let me consider...",
      } as SDKMessage;

      const messages = translateEvent(event);
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe(MessageType.MESSAGE_THINKING);
      expect(messages[0].content).toBe("Let me consider...");
    });
  });

  describe("tool_call events", () => {
    it("translates a running tool call", () => {
      const event = {
        type: "tool_call" as const,
        call_id: "tc-1",
        name: "Shell",
        status: "running",
        args: '{"command": "ls"}',
        result: null,
      } as SDKMessage;

      const messages = translateEvent(event);
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe(MessageType.MESSAGE_TOOL);
      expect(messages[0].content).toBe("Tool: Shell [running]");
      expect(messages[0].toolCalls).toHaveLength(1);

      const tc = messages[0].toolCalls[0];
      expect(tc.id).toBe("tc-1");
      expect(tc.name).toBe("Shell");
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
      expect(tc.startedAt).toBeTruthy();
      expect(tc.completedAt).toBe("");
    });

    it("translates a completed tool call", () => {
      const event = {
        type: "tool_call" as const,
        call_id: "tc-2",
        name: "Read",
        status: "completed",
        result: "file contents",
      } as SDKMessage;

      const messages = translateEvent(event);
      const tc = messages[0].toolCalls[0];
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
      expect(tc.result).toBe("file contents");
      expect(tc.completedAt).toBeTruthy();
      expect(tc.error).toBe("");
    });

    it("translates a failed tool call", () => {
      const event = {
        type: "tool_call" as const,
        call_id: "tc-3",
        name: "Shell",
        status: "error",
        result: "permission denied",
      } as SDKMessage;

      const messages = translateEvent(event);
      const tc = messages[0].toolCalls[0];
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
      expect(tc.error).toBe("permission denied");
      expect(tc.completedAt).toBeTruthy();
    });

    it("serializes object args to JSON", () => {
      const event = {
        type: "tool_call" as const,
        call_id: "tc-4",
        name: "Write",
        status: "running",
        args: { path: "/tmp/file.txt", contents: "data" },
        result: null,
      } as SDKMessage;

      const messages = translateEvent(event);
      const tc = messages[0].toolCalls[0];
      expect(tc.argsPreview).toBe(
        JSON.stringify({ path: "/tmp/file.txt", contents: "data" }),
      );
    });

    it("maps unknown status to UNSPECIFIED", () => {
      const event = {
        type: "tool_call" as const,
        call_id: "tc-5",
        name: "Unknown",
        status: "pending",
        result: null,
      } as SDKMessage;

      const messages = translateEvent(event);
      const tc = messages[0].toolCalls[0];
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_STATUS_UNSPECIFIED);
    });
  });

  describe("task events", () => {
    it("translates a task event with text", () => {
      const event = {
        type: "task" as const,
        text: "Setting up workspace",
      } as SDKMessage;

      const messages = translateEvent(event);
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe(MessageType.MESSAGE_SYSTEM);
      expect(messages[0].content).toBe("Setting up workspace");
    });

    it("returns empty array for task events without text", () => {
      const event = {
        type: "task" as const,
        text: "",
      } as SDKMessage;

      const messages = translateEvent(event);
      expect(messages).toHaveLength(0);
    });
  });

  describe("informational events produce no messages", () => {
    it.each(["system", "status", "user", "request"] as const)(
      "returns empty array for %s events",
      (type) => {
        const event = { type } as SDKMessage;
        expect(translateEvent(event)).toHaveLength(0);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Test helpers for SDK event construction
// ---------------------------------------------------------------------------

function assistantEvent(runId: string, text: string): SDKMessage {
  return {
    type: "assistant",
    agent_id: "agent-1",
    run_id: runId,
    message: { role: "assistant", content: [{ type: "text", text }] },
  } as SDKMessage;
}

function thinkingEvent(runId: string, text: string): SDKMessage {
  return {
    type: "thinking",
    agent_id: "agent-1",
    run_id: runId,
    text,
  } as SDKMessage;
}

function toolCallEvent(
  runId: string,
  callId: string,
  name: string,
  status: "running" | "completed" | "error",
): SDKMessage {
  return {
    type: "tool_call",
    agent_id: "agent-1",
    run_id: runId,
    call_id: callId,
    name,
    status,
    result: status === "completed" ? "ok" : null,
  } as SDKMessage;
}

function taskEvent(text: string): SDKMessage {
  return {
    type: "task",
    agent_id: "agent-1",
    run_id: "run-1",
    text,
  } as SDKMessage;
}

// ---------------------------------------------------------------------------
// MessageAccumulator tests
// ---------------------------------------------------------------------------

describe("MessageAccumulator", () => {
  describe("assistant event accumulation", () => {
    it("merges multiple assistant events with same run_id into one message", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages);

      acc.processEvent(assistantEvent("run-1", "Two"));
      acc.processEvent(assistantEvent("run-1", " plus"));
      acc.processEvent(assistantEvent("run-1", " two"));
      acc.processEvent(assistantEvent("run-1", " equals"));
      acc.processEvent(assistantEvent("run-1", " four."));
      acc.finalize();

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe(MessageType.MESSAGE_AI);
      expect(messages[0].content).toBe("Two plus two equals four.");
    });

    it("sets is_streaming=true during accumulation, false after finalize", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages);

      acc.processEvent(assistantEvent("run-1", "Hello"));
      expect(messages[0].isStreaming).toBe(true);

      acc.processEvent(assistantEvent("run-1", " world"));
      expect(messages[0].isStreaming).toBe(true);

      acc.finalize();
      expect(messages[0].isStreaming).toBe(false);
    });

    it("creates separate messages for different run_ids", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages);

      acc.processEvent(assistantEvent("run-1", "First turn."));
      acc.processEvent(assistantEvent("run-2", "Second turn."));
      acc.finalize();

      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe("First turn.");
      expect(messages[1].content).toBe("Second turn.");
    });

    it("ignores assistant events with no text blocks", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages);

      const emptyEvent = {
        type: "assistant",
        agent_id: "agent-1",
        run_id: "run-1",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: "Shell", input: {} }],
        },
      } as SDKMessage;

      acc.processEvent(emptyEvent);
      acc.finalize();

      expect(messages).toHaveLength(0);
    });
  });

  describe("thinking event accumulation", () => {
    it("merges multiple thinking events with same run_id", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages);

      acc.processEvent(thinkingEvent("run-1", "Let me "));
      acc.processEvent(thinkingEvent("run-1", "think about "));
      acc.processEvent(thinkingEvent("run-1", "this."));
      acc.finalize();

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe(MessageType.MESSAGE_THINKING);
      expect(messages[0].content).toBe("Let me think about this.");
      expect(messages[0].isStreaming).toBe(false);
    });

    it("ignores thinking events with empty text", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages);

      acc.processEvent(thinkingEvent("run-1", ""));
      acc.finalize();

      expect(messages).toHaveLength(0);
    });
  });

  describe("tool call events", () => {
    it("creates a distinct message for each tool call", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages);

      acc.processEvent(toolCallEvent("run-1", "tc-1", "Shell", "running"));
      acc.processEvent(toolCallEvent("run-1", "tc-1", "Shell", "completed"));
      acc.finalize();

      expect(messages).toHaveLength(2);
      expect(messages[0].type).toBe(MessageType.MESSAGE_TOOL);
      expect(messages[1].type).toBe(MessageType.MESSAGE_TOOL);
    });
  });

  describe("interleaved event types", () => {
    it("handles assistant -> tool_call -> assistant sequence correctly", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages);

      // First turn: text
      acc.processEvent(assistantEvent("run-1", "I'll read "));
      acc.processEvent(assistantEvent("run-1", "the file."));

      // Tool call finalizes the active AI message
      acc.processEvent(toolCallEvent("run-1", "tc-1", "Read", "running"));
      acc.processEvent(toolCallEvent("run-1", "tc-1", "Read", "completed"));

      // Second turn: more text (same run_id but AI was finalized by tool_call)
      acc.processEvent(assistantEvent("run-2", "The file contains data."));

      acc.finalize();

      expect(messages).toHaveLength(4);
      expect(messages[0].type).toBe(MessageType.MESSAGE_AI);
      expect(messages[0].content).toBe("I'll read the file.");
      expect(messages[0].isStreaming).toBe(false);
      expect(messages[1].type).toBe(MessageType.MESSAGE_TOOL);
      expect(messages[2].type).toBe(MessageType.MESSAGE_TOOL);
      expect(messages[3].type).toBe(MessageType.MESSAGE_AI);
      expect(messages[3].content).toBe("The file contains data.");
      expect(messages[3].isStreaming).toBe(false);
    });

    it("handles thinking -> assistant within same run_id", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages);

      acc.processEvent(thinkingEvent("run-1", "Hmm, "));
      acc.processEvent(thinkingEvent("run-1", "let me check."));
      acc.processEvent(assistantEvent("run-1", "Here is the answer."));
      acc.finalize();

      expect(messages).toHaveLength(2);
      expect(messages[0].type).toBe(MessageType.MESSAGE_THINKING);
      expect(messages[0].content).toBe("Hmm, let me check.");
      expect(messages[1].type).toBe(MessageType.MESSAGE_AI);
      expect(messages[1].content).toBe("Here is the answer.");
    });
  });

  describe("task events", () => {
    it("passes through task events as system messages", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages);

      acc.processEvent(taskEvent("Setting up workspace"));
      acc.finalize();

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe(MessageType.MESSAGE_SYSTEM);
      expect(messages[0].content).toBe("Setting up workspace");
    });

    it("ignores task events with empty text", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages);

      acc.processEvent(taskEvent(""));
      acc.finalize();

      expect(messages).toHaveLength(0);
    });
  });

  describe("ignored event types", () => {
    it("ignores system, status, user, and request events", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages);

      acc.processEvent({ type: "system" } as SDKMessage);
      acc.processEvent({ type: "status" } as SDKMessage);
      acc.processEvent({ type: "user" } as SDKMessage);
      acc.processEvent({ type: "request" } as SDKMessage);
      acc.finalize();

      expect(messages).toHaveLength(0);
    });
  });

  describe("finalize", () => {
    it("is idempotent — calling twice does not break", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages);

      acc.processEvent(assistantEvent("run-1", "Hello"));
      acc.finalize();
      acc.finalize();

      expect(messages).toHaveLength(1);
      expect(messages[0].isStreaming).toBe(false);
    });
  });
});

describe("extractDeniedToolCalls", () => {
  it("extracts tool_call events with error status", () => {
    const events: SDKMessage[] = [
      {
        type: "tool_call",
        call_id: "tc-d1",
        name: "Shell",
        status: "error",
        args: "rm -rf /",
      } as SDKMessage,
      {
        type: "tool_call",
        call_id: "tc-ok",
        name: "Read",
        status: "completed",
        result: "ok",
      } as SDKMessage,
    ];

    const denied = extractDeniedToolCalls(events);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toEqual({
      callId: "tc-d1",
      name: "Shell",
      argsPreview: "rm -rf /",
    });
  });

  it("serializes object args to JSON string", () => {
    const events: SDKMessage[] = [
      {
        type: "tool_call",
        call_id: "tc-d2",
        name: "Delete",
        status: "error",
        args: { path: "/tmp" },
      } as SDKMessage,
    ];

    const denied = extractDeniedToolCalls(events);
    expect(denied[0].argsPreview).toBe(JSON.stringify({ path: "/tmp" }));
  });

  it("returns empty argsPreview when args is null", () => {
    const events: SDKMessage[] = [
      {
        type: "tool_call",
        call_id: "tc-d3",
        name: "Shell",
        status: "error",
        args: null,
      } as SDKMessage,
    ];

    const denied = extractDeniedToolCalls(events);
    expect(denied[0].argsPreview).toBe("");
  });

  it("ignores non-tool_call events", () => {
    const events: SDKMessage[] = [
      { type: "assistant", message: { content: [] } } as unknown as SDKMessage,
      { type: "thinking", text: "hmm" } as unknown as SDKMessage,
    ];

    expect(extractDeniedToolCalls(events)).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(extractDeniedToolCalls([])).toHaveLength(0);
  });
});
