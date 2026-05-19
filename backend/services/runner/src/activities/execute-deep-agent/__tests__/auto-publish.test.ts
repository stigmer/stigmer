import { describe, it, expect, vi, beforeEach } from "vitest";
import { create, type JsonObject } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { autoPublishWrittenFiles } from "../auto-publish.js";
import type { InlinePublisher } from "../inline-publisher.js";

function makeStatus(toolCalls: { name: string; args?: Record<string, unknown> }[]): AgentExecutionStatus {
  const status = create(AgentExecutionStatusSchema, {});
  const msg = create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content: "test",
    timestamp: "2026-01-01T00:00:00Z",
  });

  for (const tc of toolCalls) {
    const toolCall = create(ToolCallSchema, {
      id: `tc-${tc.name}`,
      name: tc.name,
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
    });
    if (tc.args) {
      toolCall.args = tc.args as JsonObject;
    }
    msg.toolCalls.push(toolCall);
  }

  status.messages.push(msg);
  return status;
}

function mockInlinePublisher(alreadyPublished: string[] = []): InlinePublisher & {
  publishCalls: string[];
} {
  const publishCalls: string[] = [];
  return {
    publishCalls,
    publishedPaths: new Set(alreadyPublished),
    publish: vi.fn(async (path: string) => {
      publishCalls.push(path);
    }),
  } as any;
}

describe("autoPublishWrittenFiles", () => {
  it("publishes files from write_file tool calls", async () => {
    const status = makeStatus([
      { name: "write_file", args: { path: "src/main.ts" } },
    ]);
    const publisher = mockInlinePublisher();

    const count = await autoPublishWrittenFiles(status, publisher);

    expect(count).toBe(1);
    expect(publisher.publishCalls).toEqual(["src/main.ts"]);
  });

  it("publishes files from edit_file tool calls", async () => {
    const status = makeStatus([
      { name: "edit_file", args: { file_path: "/src/app.tsx" } },
    ]);
    const publisher = mockInlinePublisher();

    const count = await autoPublishWrittenFiles(status, publisher);

    expect(count).toBe(1);
    expect(publisher.publishCalls).toEqual(["src/app.tsx"]);
  });

  it("skips already-published paths", async () => {
    const status = makeStatus([
      { name: "write_file", args: { path: "src/main.ts" } },
    ]);
    const publisher = mockInlinePublisher(["src/main.ts"]);

    const count = await autoPublishWrittenFiles(status, publisher);

    expect(count).toBe(0);
    expect(publisher.publishCalls).toHaveLength(0);
  });

  it("skips non-file-modifying tools", async () => {
    const status = makeStatus([
      { name: "read_file", args: { path: "src/main.ts" } },
      { name: "search", args: { query: "test" } },
    ]);
    const publisher = mockInlinePublisher();

    const count = await autoPublishWrittenFiles(status, publisher);

    expect(count).toBe(0);
  });

  it("deduplicates paths within the same scan", async () => {
    const status = makeStatus([
      { name: "write_file", args: { path: "src/main.ts" } },
      { name: "edit_file", args: { path: "src/main.ts" } },
    ]);
    const publisher = mockInlinePublisher();

    const count = await autoPublishWrittenFiles(status, publisher);

    expect(count).toBe(1);
    expect(publisher.publishCalls).toEqual(["src/main.ts"]);
  });

  it("handles tool calls without args gracefully", async () => {
    const status = makeStatus([
      { name: "write_file" },
    ]);
    const publisher = mockInlinePublisher();

    const count = await autoPublishWrittenFiles(status, publisher);

    expect(count).toBe(0);
  });

  it("handles empty tool calls", async () => {
    const status = create(AgentExecutionStatusSchema, {});
    const publisher = mockInlinePublisher();

    const count = await autoPublishWrittenFiles(status, publisher);

    expect(count).toBe(0);
  });

  it("continues on publish failure", async () => {
    const status = makeStatus([
      { name: "write_file", args: { path: "fail.ts" } },
      { name: "write_file", args: { path: "success.ts" } },
    ]);
    const publisher = mockInlinePublisher();
    let callCount = 0;
    (publisher as any).publish = vi.fn(async (path: string) => {
      callCount++;
      if (callCount === 1) throw new Error("boom");
      publisher.publishCalls.push(path);
    });

    const count = await autoPublishWrittenFiles(status, publisher);

    expect(count).toBe(1);
  });
});
