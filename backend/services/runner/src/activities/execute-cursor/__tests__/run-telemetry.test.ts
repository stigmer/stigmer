/**
 * A Cursor turn's spans (`run-telemetry.ts`), read back from a real tracer
 * provider: an `invoke_agent Cursor` CLIENT span under the run's span, an
 * `execute_tool` span per tool call built from the translator's transcript
 * facts, and the run's tokens summed over every usage report.
 *
 * Pinned: one span per call however often the stream restates its start;
 * MCP calls as extension tools; results only with content on; a failed call
 * and a failed turn marked; input tokens counting Cursor's cache reads and
 * writes; open calls ended with the turn; `end` idempotent.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SpanKind, SpanStatusCode, context, propagation, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

import type { TranscriptEvent } from "../../../harness/transcript/events.js";
import { TELEMETRY_OFF, adoptTelemetrySettings, resetTelemetrySettingsForTests } from "../../../otel-export.js";
import { CursorRunTelemetry } from "../run-telemetry.js";

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
});

function spanNamed(name: string): ReadableSpan {
  const found = exporter.getFinishedSpans().filter((span) => span.name === name);
  expect(found, `spans named ${name}`).toHaveLength(1);
  return found[0]!;
}

function started(callId: string, name: string, input: Record<string, unknown> = {}, mcpServerSlug = ""): TranscriptEvent {
  return { kind: "tool_started", callId, name, input, mcpServerSlug };
}

/** Run `body` under a stand-in for the run's span, as the turn runtime does. */
function underRunSpan(body: () => void): ReadableSpan {
  trace.getTracer("test").startActiveSpan("invoke_agent support-bot", (run) => {
    body();
    run.end();
  });
  return spanNamed("invoke_agent support-bot");
}

describe("CursorRunTelemetry", () => {
  it("opens `invoke_agent Cursor` under the run's span, with the provider, the model and the mode", () => {
    let telemetry: CursorRunTelemetry | undefined;
    const run = underRunSpan(() => {
      telemetry = CursorRunTelemetry.start({ model: "composer-2", mode: "agent" });
    });
    telemetry!.end({ kind: "completed" });

    const span = spanNamed("invoke_agent Cursor");
    expect(span.kind).toBe(SpanKind.CLIENT);
    expect(span.parentSpanContext?.spanId).toBe(run.spanContext().spanId);
    expect(span.attributes).toMatchObject({
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.provider.name": "cursor",
      "gen_ai.agent.name": "Cursor",
      "gen_ai.request.model": "composer-2",
      "stigmer.cursor.mode": "agent",
    });
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
  });

  it("spans each tool call once under the Cursor span, however often the stream restates its start", () => {
    const telemetry = CursorRunTelemetry.start({ model: "composer-2", mode: "agent" });
    telemetry.observe([started("c1", "shell", { command: "ls" })]);
    telemetry.observe([started("c1", "shell", { command: "ls" }), { kind: "tool_finished", callId: "c1", result: "a.txt" }]);
    telemetry.observe([started("c1", "shell", { command: "ls" })]);
    telemetry.end({ kind: "completed" });

    const cursor = spanNamed("invoke_agent Cursor");
    const tool = spanNamed("execute_tool shell");
    expect(tool.parentSpanContext?.spanId).toBe(cursor.spanContext().spanId);
    expect(tool.attributes).toMatchObject({
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "shell",
      "gen_ai.tool.call.id": "c1",
      "gen_ai.tool.type": "function",
    });
    expect(tool.attributes["gen_ai.tool.call.arguments"]).toBeUndefined();
    expect(tool.attributes["gen_ai.tool.call.result"]).toBeUndefined();
  });

  it("carries a call's arguments and result with content on, and withholds a secret-like write's", () => {
    adoptTelemetrySettings({ ...TELEMETRY_OFF, content: true });
    const telemetry = CursorRunTelemetry.start({ model: "composer-2", mode: "agent" });
    telemetry.observe([
      started("c1", "shell", { command: "ls", token: "t0k" }),
      { kind: "tool_finished", callId: "c1", result: "a.txt" },
      started("c2", "Write", { path: ".env", contents: "API_KEY=shh" }),
      { kind: "tool_finished", callId: "c2", result: "wrote .env" },
    ]);
    telemetry.end({ kind: "completed" });

    const shell = spanNamed("execute_tool shell").attributes;
    expect(JSON.parse(String(shell["gen_ai.tool.call.arguments"]))).toEqual({ command: "ls", token: "[REDACTED]" });
    expect(shell["gen_ai.tool.call.result"]).toBe("a.txt");
    const write = spanNamed("execute_tool Write").attributes;
    expect(JSON.parse(String(write["gen_ai.tool.call.arguments"]))).toEqual({ path: ".env" });
    expect(write["gen_ai.tool.call.result"]).toBeUndefined();
  });

  it("spans an MCP call as an extension tool of its server, and marks a failed call", () => {
    const telemetry = CursorRunTelemetry.start({ model: "composer-2", mode: "agent" });
    telemetry.observe([
      started("m1", "search_services", { q: "x" }, "planton"),
      { kind: "tool_error", callId: "m1", message: "server unavailable" },
    ]);
    telemetry.end({ kind: "completed" });

    const span = spanNamed("execute_tool search_services");
    expect(span.attributes).toMatchObject({
      "gen_ai.tool.type": "extension",
      "mcp.method.name": "tools/call",
      "stigmer.mcp.server_name": "planton",
      "error.type": "tool_error",
    });
    expect(span.status, "with content off, no failure text").toEqual({ code: SpanStatusCode.ERROR });
  });

  it("sums every usage report, counting cache reads and writes in the input", () => {
    const telemetry = CursorRunTelemetry.start({ model: "composer-2", mode: "agent" });
    telemetry.usage({ inputTokens: 100, outputTokens: 10, cacheReadTokens: 400, cacheWriteTokens: 50 });
    telemetry.usage({ inputTokens: 20, outputTokens: 5 });
    telemetry.end({ kind: "completed" });

    expect(spanNamed("invoke_agent Cursor").attributes).toMatchObject({
      "gen_ai.usage.input_tokens": 570,
      "gen_ai.usage.output_tokens": 15,
      "gen_ai.usage.cache_read.input_tokens": 400,
      "gen_ai.usage.cache_write.input_tokens": 50,
    });
  });

  it("marks a failed turn with its surface, ends open calls with the turn, and ends once", () => {
    const telemetry = CursorRunTelemetry.start({ model: "composer-2", mode: "agent" });
    telemetry.observe([started("c1", "shell", { command: "sleep 9" })]);
    telemetry.end({ kind: "failed", message: "the Cursor key was refused", surface: "actionable" });
    telemetry.end({ kind: "completed" });
    telemetry.observe([started("c2", "shell")]);

    const cursor = spanNamed("invoke_agent Cursor");
    expect(cursor.status, "with content off, no failure text").toEqual({ code: SpanStatusCode.ERROR });
    expect(cursor.attributes["error.type"]).toBe("actionable");
    expect(spanNamed("execute_tool shell").status.code).toBe(SpanStatusCode.UNSET);
    expect(exporter.getFinishedSpans()).toHaveLength(2);
  });
});
