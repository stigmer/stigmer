import { describe, it, expect } from "vitest";
import { MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { SDKMessage } from "@cursor/sdk";
import {
  translateEvent,
  extractDeniedToolCalls,
  utcTimestamp,
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
      { type: "assistant", message: { content: [] } } as SDKMessage,
      { type: "thinking", text: "hmm" } as SDKMessage,
    ];

    expect(extractDeniedToolCalls(events)).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(extractDeniedToolCalls([])).toHaveLength(0);
  });
});
