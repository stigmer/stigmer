/**
 * Unit tests for Cursor MCP image-result normalization.
 *
 * The Cursor SDK wraps an MCP tool result as
 *   { status, value: { content: [ { text:{text} }, { image:{ data, mimeType } } ] } }
 * where image `data` is a Node Buffer-JSON ({ type:"Buffer", data:number[] }).
 * The translator must re-emit that as the canonical top-level content-block
 * array the shared persist-time offload consumes, so a screenshot lands as a
 * renderable image ToolCallOutputRef instead of text/plain. These tests pin
 * that normalization and confirm it flows end-to-end through the offload.
 */

import { describe, it, expect, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SDKMessage } from "@cursor/sdk";
import type { ArtifactStorage } from "../../../shared/artifact-storage.js";
import {
  offloadOversizedToolOutputs,
  detectImagePayload,
} from "../../../shared/status-offload.js";
import {
  toResultString,
  canonicalizeImageResult,
  buildToolCallProto,
  MessageAccumulator,
} from "../message-translator.js";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";

// PNG signature + a little payload, the way the Cursor SDK serializes bytes.
const PNG_BYTES = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
const PNG_BASE64 = Buffer.from(PNG_BYTES).toString("base64");

function cursorImageEnvelope(text = "App=com.example") {
  return {
    status: "success",
    value: {
      content: [
        { text: { text } },
        { image: { data: { type: "Buffer", data: PNG_BYTES }, mimeType: "image/png" } },
      ],
      isError: false,
    },
  };
}

describe("canonicalizeImageResult", () => {
  it("converts a Cursor image envelope (Buffer-JSON) to the canonical array", () => {
    const out = canonicalizeImageResult(cursorImageEnvelope("App=Slack"));
    expect(out).toBeDefined();
    expect(JSON.parse(out!)).toEqual([
      { type: "text", text: "App=Slack" },
      { type: "image", data: PNG_BASE64, mimeType: "image/png" },
    ]);
  });

  it("handles a bare { content: [...] } envelope (no status/value wrapper)", () => {
    const out = canonicalizeImageResult({
      content: [{ image: { data: { type: "Buffer", data: PNG_BYTES }, mimeType: "image/png" } }],
    });
    expect(JSON.parse(out!)).toEqual([
      { type: "image", data: PNG_BASE64, mimeType: "image/png" },
    ]);
  });

  it("accepts an already-base64 image data string", () => {
    const out = canonicalizeImageResult({
      content: [{ image: { data: PNG_BASE64, mimeType: "image/png" } }],
    });
    expect(JSON.parse(out!)).toEqual([
      { type: "image", data: PNG_BASE64, mimeType: "image/png" },
    ]);
  });

  it("accepts a data: URL image data string", () => {
    const out = canonicalizeImageResult({
      content: [{ image: { data: `data:image/png;base64,${PNG_BASE64}`, mimeType: "image/png" } }],
    });
    expect(JSON.parse(out!)).toEqual([
      { type: "image", data: PNG_BASE64, mimeType: "image/png" },
    ]);
  });

  it("defaults mimeType to image/png when absent", () => {
    const out = canonicalizeImageResult({
      content: [{ image: { data: { type: "Buffer", data: PNG_BYTES } } }],
    });
    expect(JSON.parse(out!)[0]).toEqual({ type: "image", data: PNG_BASE64, mimeType: "image/png" });
  });

  it("returns undefined for a text-only envelope (no transformation)", () => {
    expect(canonicalizeImageResult({ status: "success", value: { content: [{ text: { text: "hi" } }] } }))
      .toBeUndefined();
  });

  it("returns undefined when there is no content array", () => {
    expect(canonicalizeImageResult({ status: "success", value: { stdout: "ok" } })).toBeUndefined();
    expect(canonicalizeImageResult("plain string")).toBeUndefined();
    expect(canonicalizeImageResult(null)).toBeUndefined();
  });
});

describe("toResultString", () => {
  it("passes a string through unchanged", () => {
    expect(toResultString("just logs")).toBe("just logs");
  });

  it("returns empty string for an absent result", () => {
    expect(toResultString(null)).toBe("");
    expect(toResultString(undefined)).toBe("");
  });

  it("JSON.stringifies a non-image object unchanged (text-only envelope)", () => {
    const env = { status: "success", value: { content: [{ text: { text: "hi" } }] } };
    expect(toResultString(env)).toBe(JSON.stringify(env));
  });

  it("normalizes an image envelope to the canonical array", () => {
    const out = toResultString(cursorImageEnvelope("App=X"));
    expect(JSON.parse(out)).toEqual([
      { type: "text", text: "App=X" },
      { type: "image", data: PNG_BASE64, mimeType: "image/png" },
    ]);
  });
});

describe("buildToolCallProto image normalization", () => {
  it("produces a result the shared offload detector recognizes as an image", () => {
    const event = {
      type: "tool_call",
      agent_id: "a1",
      run_id: "r1",
      call_id: "tc-img",
      name: "mcp",
      status: "completed",
      args: { providerIdentifier: "open-computer-use", toolName: "get_app_state", args: {} },
      result: cursorImageEnvelope(),
    } as unknown as Extract<SDKMessage, { type: "tool_call" }>;

    const tc = buildToolCallProto(event);
    expect(tc.name).toBe("get_app_state");
    const img = detectImagePayload(tc.result);
    expect(img).not.toBeNull();
    expect(img?.mimeType).toBe("image/png");
    expect(img?.base64).toBe(PNG_BASE64);
    // The bloated Buffer-JSON must not survive into the persisted result.
    expect(tc.result).not.toContain('"Buffer"');
  });
});

describe("cursor image flows through the persist-time offload", () => {
  it("offloads the screenshot as an image ref with no inline bytes", async () => {
    const uploads: { key: string; contentType?: string }[] = [];
    const storage: ArtifactStorage = {
      upload: vi.fn(async (key: string, _content: Buffer, contentType?: string) => {
        uploads.push({ key, contentType });
        return key;
      }),
      getDownloadUrl: vi.fn(async (key: string) => `https://artifacts.local/${key}`),
      exists: vi.fn(async () => true),
    };

    const event = {
      type: "tool_call",
      agent_id: "a1",
      run_id: "r1",
      call_id: "tc-img",
      name: "mcp",
      status: "completed",
      args: { providerIdentifier: "open-computer-use", toolName: "get_app_state", args: {} },
      result: cursorImageEnvelope(),
    } as unknown as Extract<SDKMessage, { type: "tool_call" }>;

    const tc = buildToolCallProto(event);
    const status = create(AgentExecutionStatusSchema, {
      messages: [create(AgentMessageSchema, { toolCalls: [tc] })],
    });

    await offloadOversizedToolOutputs(status, { artifactStorage: storage, executionId: "exec-1" });

    const out = status.messages[0].toolCalls[0];
    expect(out.outputRef).toBeDefined();
    expect(out.outputRef!.isImage).toBe(true);
    expect(out.outputRef!.mimeType).toBe("image/png");
    expect(out.outputRef!.storageKey.endsWith(".png")).toBe(true);
    expect(uploads[0]?.contentType).toBe("image/png");
    // Inline result is collapsed; no base64/Buffer bytes remain in the status.
    expect(out.result).not.toContain(PNG_BASE64);
    expect(out.result).not.toContain('"Buffer"');
  });
});

describe("sub-agent image normalization (extractConversationSteps)", () => {
  it("normalizes a screenshot returned inside a sub-agent toolCall step", () => {
    const messages: AgentMessage[] = [];
    const acc = new MessageAccumulator(messages);

    const running = {
      type: "tool_call",
      agent_id: "a1",
      run_id: "r1",
      call_id: "tc-sub-img",
      name: "task",
      status: "running",
      args: { description: "screenshot", prompt: "capture" },
    } as unknown as Extract<SDKMessage, { type: "tool_call" }>;
    acc.processEvent(running);
    acc.trackSubAgentExecution(running);

    const completed = {
      type: "tool_call",
      agent_id: "a1",
      run_id: "r1",
      call_id: "tc-sub-img",
      name: "task",
      status: "completed",
      args: { description: "screenshot", prompt: "capture" },
      result: {
        status: "success",
        value: {
          conversationSteps: [
            {
              type: "toolCall",
              message: {
                type: "get_app_state",
                args: {},
                result: cursorImageEnvelope("App=SubAgent"),
              },
            },
          ],
        },
      },
    } as unknown as Extract<SDKMessage, { type: "tool_call" }>;

    acc.processEvent(completed);
    acc.trackSubAgentExecution(completed);

    const sub = acc.subAgentExecutions[0];
    const subToolResult = sub.messages[0].toolCalls[0].result;
    const img = detectImagePayload(subToolResult);
    expect(img?.base64).toBe(PNG_BASE64);
  });
});
