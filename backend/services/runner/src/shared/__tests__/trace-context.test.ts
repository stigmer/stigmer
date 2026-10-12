/**
 * A turn's trace context across the agent host's pipe
 * (`shared/trace-context.ts`): the runner reads the active span's W3C
 * `traceparent`, and the host runs the turn under it, so a span the engine
 * starts there is the run span's child in the same trace. With no recording
 * span there is nothing to carry, and the turn runs unchanged.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";

import { activeTraceparent, withTraceparent } from "../trace-context.js";

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

beforeAll(() => {
  const manager = new AsyncLocalStorageContextManager();
  manager.enable();
  context.setGlobalContextManager(manager);
  trace.setGlobalTracerProvider(provider);
});

afterAll(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
});

describe("activeTraceparent", () => {
  it("is the recording span's traceparent", async () => {
    const span = trace.getTracer("test").startSpan("run");
    const carried = await context.with(trace.setSpan(context.active(), span), () => activeTraceparent());
    span.end();
    const { traceId, spanId } = span.spanContext();
    expect(carried).toBe(`00-${traceId}-${spanId}-01`);
  });

  it("is null with no span", async () => {
    expect(await activeTraceparent()).toBeNull();
  });
});

describe("withTraceparent", () => {
  it("makes a span started inside a child of the remote span", async () => {
    const traceId = "0af7651916cd43dd8448eb211c80319c";
    const remoteSpanId = "b7ad6b7169203331";
    exporter.reset();
    await withTraceparent(`00-${traceId}-${remoteSpanId}-01`, async () => {
      trace.getTracer("test").startSpan("chat").end();
    });
    const [child] = exporter.getFinishedSpans();
    expect(child?.spanContext().traceId).toBe(traceId);
    expect(child?.parentSpanContext?.spanId).toBe(remoteSpanId);
  });

  it("runs the turn unchanged with no traceparent", async () => {
    exporter.reset();
    const result = await withTraceparent(null, async () => {
      trace.getTracer("test").startSpan("chat").end();
      return "settled";
    });
    expect(result).toBe("settled");
    expect(exporter.getFinishedSpans()[0]?.parentSpanContext).toBeUndefined();
  });
});
