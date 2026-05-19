/**
 * OpenTelemetry tracing and metrics initialization.
 *
 * Env-var-driven: reads OTEL_EXPORTER_OTLP_ENDPOINT and configures an
 * OTLP/gRPC exporter with W3C TraceContext + Baggage propagation. When
 * the env var is unset, returns null — zero overhead.
 */

export async function initTracing(serviceName: string): Promise<(() => Promise<void>) | null> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    return null;
  }

  const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");
  const { BatchSpanProcessor } = await import("@opentelemetry/sdk-trace-base");
  const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-grpc");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  const { W3CTraceContextPropagator, CompositePropagator, W3CBaggagePropagator } = await import("@opentelemetry/core");
  const otelApi = await import("@opentelemetry/api");

  const resource = resourceFromAttributes({ "service.name": serviceName });
  const exporter = new OTLPTraceExporter({ url: endpoint });
  const provider = new NodeTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
  provider.register();

  otelApi.propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  );

  console.log(`OTel tracing enabled (endpoint=${endpoint}, service=${serviceName})`);

  return async () => {
    await provider.shutdown();
  };
}

export async function initMetrics(serviceName: string): Promise<(() => Promise<void>) | null> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    return null;
  }

  const { MeterProvider, PeriodicExportingMetricReader } = await import("@opentelemetry/sdk-metrics");
  const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-grpc");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  const otelApi = await import("@opentelemetry/api");

  const resource = resourceFromAttributes({ "service.name": serviceName });
  const exporter = new OTLPMetricExporter({ url: endpoint });
  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 30_000,
  });
  const provider = new MeterProvider({ resource, readers: [reader] });

  otelApi.metrics.setGlobalMeterProvider(provider);

  console.log(`OTel metrics enabled (endpoint=${endpoint}, service=${serviceName})`);

  return async () => {
    await provider.shutdown();
  };
}

// Span names
export const SPAN_CURSOR_TURN = "stigmer.cursor.turn";
export const SPAN_DEEP_AGENT_RUN = "stigmer.deepagent.run";

// Attribute keys
export const ATTR_LLM_INPUT_TOKENS = "stigmer.llm.input_tokens";
export const ATTR_LLM_OUTPUT_TOKENS = "stigmer.llm.output_tokens";
export const ATTR_CURSOR_MODE = "stigmer.cursor.mode";
export const ATTR_CURSOR_MODEL = "stigmer.cursor.model";
export const ATTR_SESSION_ID = "stigmer.session.id";
export const ATTR_HARNESS = "stigmer.harness";

// Baggage keys
export const BAGGAGE_EXECUTION_ID = "stigmer.execution_id";
export const BAGGAGE_SESSION_ID = "stigmer.session_id";
export const BAGGAGE_ORG_ID = "stigmer.org_id";

/**
 * Start a cursor turn span. No-op when tracing is not initialized.
 */
export async function startCursorTurnSpan(attrs: {
  model: string;
  mode: string;
  sessionId: string;
}): Promise<{ setTokens(input: number, output: number): void; end(): void }> {
  const noop = { setTokens() {}, end() {} };
  try {
    const otelApi = await import("@opentelemetry/api");
    const tracer = otelApi.trace.getTracer("stigmer-runner");
    const span = tracer.startSpan(SPAN_CURSOR_TURN, {
      attributes: {
        [ATTR_CURSOR_MODEL]: attrs.model,
        [ATTR_CURSOR_MODE]: attrs.mode,
        [ATTR_SESSION_ID]: attrs.sessionId,
      },
    });
    return {
      setTokens(input: number, output: number) {
        if (input) span.setAttribute(ATTR_LLM_INPUT_TOKENS, input);
        if (output) span.setAttribute(ATTR_LLM_OUTPUT_TOKENS, output);
      },
      end() {
        span.end();
      },
    };
  } catch {
    return noop;
  }
}

/**
 * Record cursor turn metrics. No-op when metrics are not initialized.
 */
export async function recordTurnMetrics(opts: {
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
  mode: string;
}): Promise<void> {
  try {
    const otelApi = await import("@opentelemetry/api");
    const meter = otelApi.metrics.getMeter("stigmer-runner");

    const attrs = {
      [ATTR_CURSOR_MODEL]: opts.model,
      [ATTR_CURSOR_MODE]: opts.mode,
    };

    meter.createHistogram("stigmer.llm.call.duration", { unit: "ms" })
      .record(opts.durationMs, attrs);
    meter.createCounter("stigmer.llm.call.count")
      .add(1, attrs);

    if (opts.inputTokens) {
      meter.createCounter("stigmer.llm.tokens.input", { unit: "{token}" })
        .add(opts.inputTokens, attrs);
    }
    if (opts.outputTokens) {
      meter.createCounter("stigmer.llm.tokens.output", { unit: "{token}" })
        .add(opts.outputTokens, attrs);
    }
  } catch {
    // Metrics not initialized — silently skip.
  }
}

export async function setBaggage(items: Record<string, string>): Promise<void> {
  try {
    const otelApi = await import("@opentelemetry/api");
    const ctx = otelApi.context.active();
    let bag = otelApi.propagation.getBaggage(ctx) ?? otelApi.propagation.createBaggage();
    for (const [k, v] of Object.entries(items)) {
      if (v) {
        bag = bag.setEntry(k, { value: v });
      }
    }
    const newCtx = otelApi.propagation.setBaggage(ctx, bag);
    otelApi.context.with(newCtx, () => {});
  } catch {
    // Tracing not initialized — silently skip.
  }
}
