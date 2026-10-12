/**
 * The native engine's spans (`otel-spans.ts`), read back from a real tracer
 * provider into an in-memory exporter: a `chat {model}` CLIENT span per
 * model call and an `execute_tool {tool}` INTERNAL span per tool call, in
 * OpenTelemetry's GenAI conventions, and `withSubAgentSpan`'s
 * `invoke_agent {name}`.
 *
 * Pinned: the names, kinds and parents; the provider and models from the
 * facts `buildChatModel` records (never a guess from the model's name);
 * usage with cached tokens; the response id and finish reason; every tool,
 * built-in or MCP, gets a span; the conversation's text only with content
 * on, and then never more than the saved conversation shows (a `.env`
 * write reads `{ path }` with no result, a `token` argument is redacted);
 * failures mark the span, a LangGraph pause does not. The handlers' results
 * pass through unchanged.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { GraphInterrupt } from "@langchain/langgraph";
import { SpanKind, SpanStatusCode, context, propagation, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

import { createOtelSpansMiddleware, withSubAgentSpan } from "../otel-spans.js";
import type { ToolCallRequest, ModelCallRequest } from "../types.js";
import { TELEMETRY_OFF, adoptTelemetrySettings, resetTelemetrySettingsForTests } from "../../otel-export.js";
import { buildChatModel } from "../../shared/model-client.js";
import { _resetRegistryCache } from "../../shared/model-registry.js";

const exporter = new InMemorySpanExporter();
let provider: NodeTracerProvider;

beforeAll(() => {
  provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  provider.register();
});

afterAll(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
  propagation.disable();
});

afterEach(() => {
  exporter.reset();
  resetTelemetrySettingsForTests();
  vi.restoreAllMocks();
});

function contentOn(): void {
  adoptTelemetrySettings({ ...TELEMETRY_OFF, content: true });
}

function spans(): ReadableSpan[] {
  return exporter.getFinishedSpans();
}

function spanNamed(name: string): ReadableSpan {
  const found = spans().find((span) => span.name === name);
  if (!found) throw new Error(`no span named ${name}; have ${spans().map((s) => s.name).join(", ")}`);
  return found;
}

function parentOf(span: ReadableSpan): string | undefined {
  return span.parentSpanContext?.spanId;
}

function makeToolRequest(name = "mcp_tool", args: Record<string, unknown> = {}): ToolCallRequest {
  return {
    toolCall: { id: "tc_1", name, args },
    tool: undefined,
    state: { messages: [] },
    runtime: {},
  };
}

function makeModelRequest(overrides: Partial<ModelCallRequest> = {}): ModelCallRequest {
  return {
    model: { model: "claude-sonnet-4-6" },
    messages: [],
    state: { messages: [] },
    runtime: {},
    ...overrides,
  };
}

/** A model `buildChatModel` built for real (no network: the registry read is answered here). */
async function builtModel(): Promise<unknown> {
  _resetRegistryCache();
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ models: [{ id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", provider: "anthropic" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-not-a-key");
  const { model } = await buildChatModel({ modelName: "claude-haiku-4.5" });
  vi.unstubAllEnvs();
  _resetRegistryCache();
  return model;
}

function answer(fields: ConstructorParameters<typeof AIMessage>[0]): AIMessage {
  return new AIMessage(fields);
}

describe("OtelSpansMiddleware", () => {
  describe("wrapModelCall", () => {
    it("passes through to handler and returns response", async () => {
      const mw = createOtelSpansMiddleware();
      const aiMsg = new AIMessage({ content: "hello" });
      const handler = vi.fn().mockResolvedValue(aiMsg);

      const result = await mw.wrapModelCall!(makeModelRequest(), handler);
      expect(handler).toHaveBeenCalled();
      expect(result).toBe(aiMsg);
    });

    it("propagates errors from handler", async () => {
      const mw = createOtelSpansMiddleware();
      const handler = vi.fn().mockRejectedValue(new Error("model failed"));

      await expect(mw.wrapModelCall!(makeModelRequest(), handler))
        .rejects.toThrow("model failed");
    });

    it("spans the call as `chat <registry id>` with the provider and models buildChatModel recorded", async () => {
      const model = await builtModel();
      const mw = createOtelSpansMiddleware();
      await mw.wrapModelCall!(makeModelRequest({ model }), async () => answer({ content: "hi" }));

      const span = spanNamed("chat claude-haiku-4.5");
      expect(span.kind).toBe(SpanKind.CLIENT);
      expect(span.attributes).toMatchObject({
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": "claude-haiku-4.5",
        "gen_ai.provider.name": "anthropic",
        "gen_ai.response.model": "claude-haiku-4-5-20251001",
      });
    });

    it("names a model it did not build by the model's own name, with no provider guessed", async () => {
      const mw = createOtelSpansMiddleware();
      await mw.wrapModelCall!(makeModelRequest(), async () => answer({ content: "hi" }));

      const span = spanNamed("chat claude-sonnet-4-6");
      expect(span.attributes["gen_ai.provider.name"]).toBeUndefined();
    });

    it("records usage with cached tokens, the response id and the finish reason", async () => {
      const mw = createOtelSpansMiddleware();
      await mw.wrapModelCall!(makeModelRequest(), async () =>
        answer({
          content: "hi",
          id: "msg_123",
          usage_metadata: {
            input_tokens: 120,
            output_tokens: 30,
            total_tokens: 150,
            input_token_details: { cache_read: 80, cache_creation: 20 },
          },
          response_metadata: { stop_reason: "end_turn" },
        }),
      );

      expect(spanNamed("chat claude-sonnet-4-6").attributes).toMatchObject({
        "gen_ai.usage.input_tokens": 120,
        "gen_ai.usage.output_tokens": 30,
        "gen_ai.usage.cache_read.input_tokens": 80,
        "gen_ai.usage.cache_write.input_tokens": 20,
        "gen_ai.response.id": "msg_123",
        "gen_ai.response.finish_reasons": ["end_turn"],
      });
    });

    it("reads a streamed answer's finish reason from its additional kwargs", async () => {
      const mw = createOtelSpansMiddleware();
      await mw.wrapModelCall!(makeModelRequest(), async () =>
        answer({ content: "hi", additional_kwargs: { stop_reason: "tool_use" } }),
      );

      expect(spanNamed("chat claude-sonnet-4-6").attributes["gen_ai.response.finish_reasons"]).toEqual(["tool_use"]);
    });

    it("carries no text by default", async () => {
      const mw = createOtelSpansMiddleware();
      await mw.wrapModelCall!(
        makeModelRequest({ systemPrompt: "be brief", messages: [new HumanMessage("hello")] }),
        async () => answer({ content: "hi" }),
      );

      const attributes = spanNamed("chat claude-sonnet-4-6").attributes;
      expect(attributes["gen_ai.system_instructions"]).toBeUndefined();
      expect(attributes["gen_ai.input.messages"]).toBeUndefined();
      expect(attributes["gen_ai.output.messages"]).toBeUndefined();
    });

    it("with content on, carries the conversation in the conventions' shape, withholding what the saved conversation withholds", async () => {
      contentOn();
      const mw = createOtelSpansMiddleware();
      const messages = [
        new HumanMessage("set the key"),
        new AIMessage({
          content: "writing it",
          tool_calls: [
            { id: "w_env", name: "write_file", args: { file_path: ".env", content: "API_KEY=shh" } },
            { id: "c_tok", name: "call_api", args: { url: "https://x", token: "s3cr3t" } },
          ],
        }),
        new ToolMessage({ content: "wrote .env", tool_call_id: "w_env" }),
        new ToolMessage({ content: "200 OK", tool_call_id: "c_tok" }),
      ];
      await mw.wrapModelCall!(
        makeModelRequest({ systemMessage: new SystemMessage("be brief"), messages }),
        async () => answer({ content: "done", response_metadata: { stop_reason: "end_turn" } }),
      );

      const attributes = spanNamed("chat claude-sonnet-4-6").attributes;
      expect(JSON.parse(String(attributes["gen_ai.system_instructions"]))).toEqual([{ type: "text", content: "be brief" }]);
      const input = JSON.parse(String(attributes["gen_ai.input.messages"])) as unknown;
      expect(input).toEqual([
        { role: "user", parts: [{ type: "text", content: "set the key" }] },
        {
          role: "assistant",
          parts: [
            { type: "text", content: "writing it" },
            { type: "tool_call", id: "w_env", name: "write_file", arguments: { path: ".env" } },
            { type: "tool_call", id: "c_tok", name: "call_api", arguments: { url: "https://x", token: "[REDACTED]" } },
          ],
        },
        { role: "tool", parts: [{ type: "tool_call_response", id: "w_env", response: null }] },
        { role: "tool", parts: [{ type: "tool_call_response", id: "c_tok", response: "200 OK" }] },
      ]);
      expect(JSON.stringify(input)).not.toContain("shh");
      expect(JSON.stringify(input)).not.toContain("s3cr3t");
      expect(JSON.parse(String(attributes["gen_ai.output.messages"]))).toEqual([
        { role: "assistant", parts: [{ type: "text", content: "done" }], finish_reason: "end_turn" },
      ]);
    });

    it("marks a failed call and rethrows", async () => {
      const mw = createOtelSpansMiddleware();
      class ProviderDown extends Error {
        override name = "ProviderDown";
      }
      await expect(
        mw.wrapModelCall!(makeModelRequest(), async () => {
          throw new ProviderDown("529 overloaded");
        }),
      ).rejects.toThrow("529 overloaded");

      const span = spanNamed("chat claude-sonnet-4-6");
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      expect(span.attributes["error.type"]).toBe("ProviderDown");
    });
  });

  describe("wrapToolCall", () => {
    it("wraps MCP tools that are in the server map", async () => {
      const mw = createOtelSpansMiddleware({
        toolServerMap: new Map([["mcp_tool", "my-server"]]),
      });
      const msg = new ToolMessage({ content: "ok", tool_call_id: "tc_1", name: "mcp_tool" });
      const handler = vi.fn().mockResolvedValue(msg);

      const result = await mw.wrapToolCall!(makeToolRequest("mcp_tool"), handler);
      expect(handler).toHaveBeenCalled();
      expect(result).toBe(msg);

      const span = spanNamed("execute_tool mcp_tool");
      expect(span.kind).toBe(SpanKind.INTERNAL);
      expect(span.attributes).toMatchObject({
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": "mcp_tool",
        "gen_ai.tool.call.id": "tc_1",
        "gen_ai.tool.type": "extension",
        "mcp.method.name": "tools/call",
        "stigmer.mcp.server_name": "my-server",
      });
    });

    it("propagates errors from MCP tool handler", async () => {
      const mw = createOtelSpansMiddleware({
        toolServerMap: new Map([["mcp_tool", "my-server"]]),
      });
      const handler = vi.fn().mockRejectedValue(new Error("tool failed"));

      await expect(mw.wrapToolCall!(makeToolRequest("mcp_tool"), handler))
        .rejects.toThrow("tool failed");
      expect(spanNamed("execute_tool mcp_tool").status.code).toBe(SpanStatusCode.ERROR);
    });

    it("spans a built-in tool as a function tool, with no MCP attributes", async () => {
      const mw = createOtelSpansMiddleware({ toolServerMap: new Map([["other_tool", "server-a"]]) });
      const msg = new ToolMessage({ content: "ok", tool_call_id: "tc_1", name: "read_file" });

      const result = await mw.wrapToolCall!(makeToolRequest("read_file", { file_path: "/a.txt" }), async () => msg);
      expect(result).toBe(msg);

      const attributes = spanNamed("execute_tool read_file").attributes;
      expect(attributes["gen_ai.tool.type"]).toBe("function");
      expect(attributes["mcp.method.name"]).toBeUndefined();
      expect(attributes["stigmer.mcp.server_name"]).toBeUndefined();
    });

    it("carries the arguments and result only with content on", async () => {
      const mw = createOtelSpansMiddleware();
      const msg = new ToolMessage({ content: "file body", tool_call_id: "tc_1" });
      await mw.wrapToolCall!(makeToolRequest("read_file", { file_path: "/a.txt", token: "t0k" }), async () => msg);
      const off = spanNamed("execute_tool read_file").attributes;
      expect(off["gen_ai.tool.call.arguments"]).toBeUndefined();
      expect(off["gen_ai.tool.call.result"]).toBeUndefined();

      exporter.reset();
      contentOn();
      await mw.wrapToolCall!(makeToolRequest("read_file", { file_path: "/a.txt", token: "t0k" }), async () => msg);
      const on = spanNamed("execute_tool read_file").attributes;
      expect(JSON.parse(String(on["gen_ai.tool.call.arguments"]))).toEqual({ file_path: "/a.txt", token: "[REDACTED]" });
      expect(on["gen_ai.tool.call.result"]).toBe("file body");
    });

    it("shows a write to a secret-like path as its path, with no result", async () => {
      contentOn();
      const mw = createOtelSpansMiddleware();
      await mw.wrapToolCall!(
        makeToolRequest("write_file", { file_path: ".env", content: "API_KEY=shh" }),
        async () => new ToolMessage({ content: "Successfully wrote .env", tool_call_id: "tc_1" }),
      );

      const attributes = spanNamed("execute_tool write_file").attributes;
      expect(JSON.parse(String(attributes["gen_ai.tool.call.arguments"]))).toEqual({ path: ".env" });
      expect(attributes["gen_ai.tool.call.result"]).toBeUndefined();
    });

    it("marks a tool that answered with an error", async () => {
      const mw = createOtelSpansMiddleware();
      await mw.wrapToolCall!(makeToolRequest("execute"), async () =>
        new ToolMessage({ content: "exit 1", tool_call_id: "tc_1", status: "error" }),
      );

      const span = spanNamed("execute_tool execute");
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      expect(span.attributes["error.type"]).toBe("tool_error");
    });

    it("does not mark a LangGraph pause as a failure", async () => {
      const mw = createOtelSpansMiddleware();
      await expect(
        mw.wrapToolCall!(makeToolRequest("task"), async () => {
          throw new GraphInterrupt([]);
        }),
      ).rejects.toBeInstanceOf(GraphInterrupt);

      expect(spanNamed("execute_tool task").status.code).toBe(SpanStatusCode.UNSET);
    });

    it("nests a model call made inside the tool under the tool's span", async () => {
      const mw = createOtelSpansMiddleware();
      await mw.wrapToolCall!(makeToolRequest("task"), async () => {
        await mw.wrapModelCall!(makeModelRequest(), async () => answer({ content: "inner" }));
        return new ToolMessage({ content: "done", tool_call_id: "tc_1" });
      });

      const tool = spanNamed("execute_tool task");
      const chat = spanNamed("chat claude-sonnet-4-6");
      expect(parentOf(chat)).toBe(tool.spanContext().spanId);
      expect(chat.spanContext().traceId).toBe(tool.spanContext().traceId);
    });
  });

  it("works with empty toolServerMap", async () => {
    const mw = createOtelSpansMiddleware();
    const msg = new ToolMessage({ content: "ok", tool_call_id: "tc_1", name: "read" });
    const handler = vi.fn().mockResolvedValue(msg);

    const result = await mw.wrapToolCall!(makeToolRequest("read"), handler);
    expect(result).toBe(msg);
  });
});

describe("withSubAgentSpan", () => {
  it("opens `invoke_agent <name>` under the active span, and what runs inside nests under it", async () => {
    const tracer = trace.getTracer("test");
    await tracer.startActiveSpan("execute_tool task", async (outer) => {
      const result = await withSubAgentSpan("researcher", async () => {
        tracer.startSpan("inner").end();
        return 7;
      });
      expect(result).toBe(7);
      outer.end();
    });

    const outer = spanNamed("execute_tool task");
    const sub = spanNamed("invoke_agent researcher");
    expect(sub.attributes).toMatchObject({ "gen_ai.operation.name": "invoke_agent", "gen_ai.agent.name": "researcher" });
    expect(parentOf(sub)).toBe(outer.spanContext().spanId);
    expect(parentOf(spanNamed("inner"))).toBe(sub.spanContext().spanId);
  });

  it("marks a failed invocation and rethrows, but not a pause", async () => {
    await expect(withSubAgentSpan("broken", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(spanNamed("invoke_agent broken").status.code).toBe(SpanStatusCode.ERROR);

    await expect(withSubAgentSpan("paused", async () => Promise.reject(new GraphInterrupt([])))).rejects.toBeInstanceOf(GraphInterrupt);
    expect(spanNamed("invoke_agent paused").status.code).toBe(SpanStatusCode.UNSET);
  });
});
