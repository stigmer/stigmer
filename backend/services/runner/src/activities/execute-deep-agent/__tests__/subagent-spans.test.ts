/**
 * A sub-agent's work in the run's trace (`subagent-wiring.ts`,
 * `subagent-transformer.ts`): its stack carries the span middleware, and
 * each invocation runs in an `invoke_agent {sub-agent}` span opened inside
 * the parent's `execute_tool task` span, so the sub-agent's own model and
 * tool calls nest under the step that started them.
 *
 * Until 2026-10 the sub-agent stack left the span middleware out, on the
 * belief that the parent's context covered it; nothing in the parent spans
 * a sub-agent's calls, so they were invisible. The nesting is proven on
 * real deepagents graphs with the scripted model: the parent delegates
 * through `task` to a sub-agent compiled by the production path, and the
 * spans are read back from a real tracer provider.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { MemorySaver } from "@langchain/langgraph";
import { createDeepAgent, StateBackend } from "deepagents";
import { context, propagation, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

import { createOtelSpansMiddleware } from "../../../middleware/otel-spans.js";
import { ToolScope } from "../../../shared/tool-lists.js";
import { buildSubAgentMiddleware } from "../subagent-wiring.js";
import { compileSubagents, type TransformedSubagent } from "../subagent-transformer.js";
import { ScriptedModel, type ScriptSelector } from "../__test-utils__/scripted-model.js";

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
});

function spansNamed(prefix: string): ReadableSpan[] {
  return exporter.getFinishedSpans().filter((span) => span.name.startsWith(prefix));
}

function only(prefix: string): ReadableSpan {
  const found = spansNamed(prefix);
  expect(found, `spans named ${prefix}*: ${exporter.getFinishedSpans().map((s) => s.name).join(", ")}`).toHaveLength(1);
  return found[0]!;
}

describe("a sub-agent's spans", () => {
  it("carries the span middleware, innermost but for the model retry, on every sub-agent stack", () => {
    const stack = buildSubAgentMiddleware();
    // The retry sits inside the span, so one span covers a call's attempts.
    expect(stack.map((m) => m.name).slice(-2)).toEqual(["OtelSpansMiddleware", "ModelRetryMiddleware"]);
  });

  it("nests the sub-agent's calls under its invoke_agent span, under the parent's task call", async () => {
    // The worker alone binds `lookup`; the script tells the two roles apart by it.
    const lookup = tool(async () => "found it", {
      name: "lookup",
      description: "look something up",
      schema: z.object({ q: z.string() }),
    });
    const script: ScriptSelector = (toolNames) =>
      toolNames.includes("lookup")
        ? { toolCalls: [{ name: "lookup", args: { q: "ticket" }, id: "lk_1" }], done: "worker done" }
        : { toolCalls: [{ name: "task", args: { description: "look it up", subagent_type: "worker" }, id: "task_1" }], done: "parent done" };

    const compiled = await compileSubagents(
      [{ name: "worker", description: "test worker", systemPrompt: "do the work", tools: [lookup] as TransformedSubagent["tools"], scope: ToolScope.unrestricted() }],
      { parentModelName: "test-model", workspaceRootDir: "", modelFactory: async () => new ScriptedModel(script) },
    );
    expect(compiled).toHaveLength(1);
    const worker = compiled[0]!;

    const parent = await createDeepAgent({
      model: new ScriptedModel(script),
      checkpointer: new MemorySaver() as never,
      backend: new StateBackend(),
      middleware: [createOtelSpansMiddleware()],
      subagents: [{ name: worker.name, description: worker.description, runnable: worker.runnable as never }],
    } as unknown as Parameters<typeof createDeepAgent>[0]);

    // Under a stand-in for the run's span, as the turn runtime runs the graph.
    await trace.getTracer("test").startActiveSpan("invoke_agent support-bot", async (run) => {
      await parent.invoke({ messages: [new HumanMessage({ content: "go" })] }, { configurable: { thread_id: "t1" }, recursionLimit: 50 });
      run.end();
    });

    const task = only("execute_tool task");
    const sub = only("invoke_agent worker");
    const lookupSpan = only("execute_tool lookup");
    expect(sub.parentSpanContext?.spanId).toBe(task.spanContext().spanId);
    expect(lookupSpan.parentSpanContext?.spanId).toBe(sub.spanContext().spanId);
    const subChats = spansNamed("chat").filter((span) => span.parentSpanContext?.spanId === sub.spanContext().spanId);
    expect(subChats.length, "the sub-agent's model calls").toBeGreaterThan(0);
    const traceIds = new Set(exporter.getFinishedSpans().map((span) => span.spanContext().traceId));
    expect(traceIds.size, "one trace, the run's").toBe(1);
  });
});
