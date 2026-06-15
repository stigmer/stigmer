import { describe, it, expect, vi } from "vitest";
import { create, toBinary } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { ArtifactStorage } from "../artifact-storage.js";
import {
  offloadOversizedToolOutputs,
  enforceStatusSizeLimit,
  detectImagePayload,
} from "../status-offload.js";

function makeFakeStorage() {
  const uploads: { key: string; size: number; contentType?: string }[] = [];
  const storage: ArtifactStorage = {
    upload: vi.fn(async (key: string, content: Buffer, contentType?: string) => {
      uploads.push({ key, size: content.length, contentType });
      return key;
    }),
    getDownloadUrl: vi.fn(async (key: string) => `https://artifacts.local/${key}`),
    exists: vi.fn(async () => true),
  };
  return { storage, uploads };
}

function statusWithToolCall(tc: ToolCall): AgentExecutionStatus {
  return create(AgentExecutionStatusSchema, {
    messages: [create(AgentMessageSchema, { toolCalls: [tc] })],
  });
}

function encodedSize(status: AgentExecutionStatus): number {
  return toBinary(AgentExecutionStatusSchema, status).length;
}

const BIG_BASE64_IMAGE = Buffer.from("x".repeat(4096)).toString("base64");

describe("detectImagePayload", () => {
  it("extracts an MCP image content block", () => {
    const result = JSON.stringify([
      { type: "text", text: "Screenshot captured" },
      { type: "image", data: BIG_BASE64_IMAGE, mimeType: "image/png" },
    ]);
    const img = detectImagePayload(result);
    expect(img).not.toBeNull();
    expect(img?.mimeType).toBe("image/png");
    expect(img?.base64).toBe(BIG_BASE64_IMAGE);
  });

  it("extracts a raw data URL", () => {
    const img = detectImagePayload(`data:image/jpeg;base64,${BIG_BASE64_IMAGE}`);
    expect(img?.mimeType).toBe("image/jpeg");
    expect(img?.base64).toBe(BIG_BASE64_IMAGE);
  });

  it("returns null for plain text", () => {
    expect(detectImagePayload("just some logs")).toBeNull();
  });

  it("extracts an image from a serialized LangChain envelope (kwargs.content)", () => {
    // Defensive shape: blocks nested under kwargs.content rather than a
    // top-level array. The extractor normalizes to a top-level array, but
    // detection must still cope if that ever drifts.
    const result = JSON.stringify({
      lc: 1,
      type: "constructor",
      id: ["langchain_core", "messages", "ToolMessage"],
      kwargs: { content: [{ type: "image", data: BIG_BASE64_IMAGE, mimeType: "image/png" }] },
    });
    const img = detectImagePayload(result);
    expect(img?.mimeType).toBe("image/png");
    expect(img?.base64).toBe(BIG_BASE64_IMAGE);
  });
});

describe("offloadOversizedToolOutputs", () => {
  it("offloads an oversized image result and renders it inline-able", async () => {
    const { storage, uploads } = makeFakeStorage();
    const result = JSON.stringify([
      { type: "image", data: BIG_BASE64_IMAGE, mimeType: "image/png" },
    ]);
    const tc = create(ToolCallSchema, { id: "tc-1", name: "screenshot", result });
    const status = statusWithToolCall(tc);

    await offloadOversizedToolOutputs(status, {
      artifactStorage: storage,
      executionId: "exec-1",
      maxInlineBytes: 256,
    });

    const out = status.messages[0].toolCalls[0];
    expect(out.outputRef).toBeDefined();
    expect(out.outputRef?.isImage).toBe(true);
    expect(out.outputRef?.mimeType).toBe("image/png");
    expect(out.outputRef?.downloadUrl).toContain("artifacts/exec-1/toolcalls/tc-1.png");
    // result is collapsed to a short label, no longer the giant blob.
    expect(out.result.length).toBeLessThan(200);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].contentType).toBe("image/png");
  });

  it("offloads oversized text with a preview head and text/plain upload", async () => {
    const { storage, uploads } = makeFakeStorage();
    const result = "LOG ".repeat(2000); // ~8 KB
    const tc = create(ToolCallSchema, { id: "tc-2", name: "Shell", result });
    const status = statusWithToolCall(tc);

    await offloadOversizedToolOutputs(status, {
      artifactStorage: storage,
      executionId: "exec-1",
      maxInlineBytes: 256,
    });

    const out = status.messages[0].toolCalls[0];
    expect(out.outputRef?.isImage).toBe(false);
    expect(out.outputRef?.mimeType).toBe("text/plain");
    expect(out.outputRef?.truncatedPreview.length).toBeGreaterThan(0);
    expect(out.result).toContain("view full output");
    expect(uploads).toHaveLength(1);
    expect(uploads[0].contentType).toBe("text/plain");
  });

  it("offloads a SMALL image regardless of size (output_ref is the only render path)", async () => {
    const { storage, uploads } = makeFakeStorage();
    // A tiny image, far below the inline byte budget. It must still offload,
    // because the UI can only render an image through ToolCallOutputRef.
    const smallImage = Buffer.from("tiny-png").toString("base64");
    const result = JSON.stringify([
      { type: "image", data: smallImage, mimeType: "image/png" },
    ]);
    const tc = create(ToolCallSchema, { id: "tc-img", name: "screenshot", result });
    const status = statusWithToolCall(tc);
    expect(result.length).toBeLessThan(256);

    await offloadOversizedToolOutputs(status, {
      artifactStorage: storage,
      executionId: "exec-1",
      maxInlineBytes: 256,
    });

    const out = status.messages[0].toolCalls[0];
    expect(out.outputRef?.isImage).toBe(true);
    expect(out.outputRef?.downloadUrl).toContain("artifacts/exec-1/toolcalls/tc-img.png");
    expect(out.result).not.toContain(smallImage);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].contentType).toBe("image/png");
  });

  it("leaves small results untouched (no artifact, no ref)", async () => {
    const { storage, uploads } = makeFakeStorage();
    const tc = create(ToolCallSchema, { id: "tc-3", name: "Read", result: "small output" });
    const status = statusWithToolCall(tc);

    await offloadOversizedToolOutputs(status, {
      artifactStorage: storage,
      executionId: "exec-1",
      maxInlineBytes: 256,
    });

    const out = status.messages[0].toolCalls[0];
    expect(out.outputRef).toBeUndefined();
    expect(out.result).toBe("small output");
    expect(uploads).toHaveLength(0);
  });

  it("is idempotent and dedupes uploads when result is re-inflated with identical bytes", async () => {
    const { storage, uploads } = makeFakeStorage();
    const result = "LOG ".repeat(2000);
    const tc = create(ToolCallSchema, { id: "tc-4", name: "Shell", result });
    const status = statusWithToolCall(tc);
    const ctx = { artifactStorage: storage, executionId: "exec-1", maxInlineBytes: 256 };

    await offloadOversizedToolOutputs(status, ctx);
    expect(uploads).toHaveLength(1);

    // Simulate mergeToolCallEvent re-inflating the inline result with the SAME
    // bytes on a subsequent persist; the ref's content hash still matches.
    status.messages[0].toolCalls[0].result = result;
    await offloadOversizedToolOutputs(status, ctx);

    expect(uploads).toHaveLength(1); // not re-uploaded
    expect(status.messages[0].toolCalls[0].result).toContain("view full output");
  });

  it("keeps the encoded status small after offloading a large blob", async () => {
    const { storage } = makeFakeStorage();
    const result = JSON.stringify([
      { type: "image", data: Buffer.from("y".repeat(500_000)).toString("base64"), mimeType: "image/png" },
    ]);
    const tc = create(ToolCallSchema, { id: "tc-5", name: "screenshot", result });
    const status = statusWithToolCall(tc);
    expect(encodedSize(status)).toBeGreaterThan(500_000);

    await offloadOversizedToolOutputs(status, {
      artifactStorage: storage,
      executionId: "exec-1",
    });

    expect(encodedSize(status)).toBeLessThan(10_000);
  });

  it("falls back to inline truncation when the upload fails (never throws)", async () => {
    const storage: ArtifactStorage = {
      upload: vi.fn(async () => { throw new Error("storage down"); }),
      getDownloadUrl: vi.fn(async (k: string) => k),
      exists: vi.fn(async () => false),
    };
    const result = "LOG ".repeat(2000);
    const tc = create(ToolCallSchema, { id: "tc-6", name: "Shell", result });
    const status = statusWithToolCall(tc);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      offloadOversizedToolOutputs(status, {
        artifactStorage: storage,
        executionId: "exec-1",
        maxInlineBytes: 256,
      }),
    ).resolves.toBeUndefined();

    const out = status.messages[0].toolCalls[0];
    expect(out.outputRef).toBeUndefined();
    expect(out.result).toContain("offload failed");
    expect(out.result.length).toBeLessThan(result.length);
  });
});

describe("enforceStatusSizeLimit", () => {
  it("returns false and changes nothing when under the limit", () => {
    const tc = create(ToolCallSchema, { id: "tc", name: "Read", result: "tiny" });
    const status = statusWithToolCall(tc);
    expect(enforceStatusSizeLimit(status, 1024 * 1024)).toBe(false);
    expect(status.messages[0].toolCalls[0].result).toBe("tiny");
  });

  it("elides the largest inline fields until the status fits", () => {
    const big = "Z".repeat(50_000);
    const status = create(AgentExecutionStatusSchema, {
      messages: [
        create(AgentMessageSchema, {
          toolCalls: [
            create(ToolCallSchema, { id: "a", name: "Shell", result: big }),
            create(ToolCallSchema, { id: "b", name: "Read", result: big }),
          ],
        }),
      ],
    });
    const before = encodedSize(status);
    expect(before).toBeGreaterThan(80_000);

    const elided = enforceStatusSizeLimit(status, 4_000);
    expect(elided).toBe(true);
    expect(encodedSize(status)).toBeLessThanOrEqual(4_000);
  });
});
