/**
 * Env-var-driven OpenTelemetry tracing initialization.
 *
 * Mirrors the workflow-runner pattern (pkg/otel/otel.go): reads
 * OTEL_EXPORTER_OTLP_ENDPOINT and configures an OTLP/gRPC exporter
 * with W3C TraceContext + Baggage propagation. When the env var is unset,
 * initTracing() returns null — zero overhead, no SDK initialization.
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
  const { W3CTraceContextPropagator, CompositePropagator } = await import("@opentelemetry/core");
  const { W3CBaggagePropagator } = await import("@opentelemetry/core");
  const otelApi = await import("@opentelemetry/api");

  const resource = resourceFromAttributes({ "service.name": serviceName });
  const exporter = new OTLPTraceExporter({ url: endpoint });
  const provider = new NodeTracerProvider({ resource, spanProcessors: [new BatchSpanProcessor(exporter)] });
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

// Span names — must match workflow-runner pkg/otel/spans.go.
export const SPAN_CURSOR_TURN = "stigmer.cursor.turn";

// Attribute keys — must match workflow-runner pkg/otel/spans.go where applicable.
export const ATTR_LLM_INPUT_TOKENS = "stigmer.llm.input_tokens";
export const ATTR_LLM_OUTPUT_TOKENS = "stigmer.llm.output_tokens";
export const ATTR_CURSOR_MODE = "stigmer.cursor.mode";
export const ATTR_CURSOR_MODEL = "stigmer.cursor.model";
export const ATTR_SESSION_ID = "stigmer.session.id";

// Baggage key constants — must match workflow-runner pkg/otel/spans.go.
export const BAGGAGE_EXECUTION_ID = "stigmer.execution_id";
export const BAGGAGE_SESSION_ID = "stigmer.session_id";
export const BAGGAGE_ORG_ID = "stigmer.org_id";

/**
 * Attach key-value pairs to the active OTel context as W3C baggage.
 * No-op when tracing is not initialized. Keys with empty values are skipped.
 */
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

/**
 * Initialize OTel metrics if OTEL_EXPORTER_OTLP_ENDPOINT is set.
 * Returns a shutdown function or null when metrics are disabled.
 */
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

/**
 * Start a cursor turn span. Returns a handle to set attributes and end the
 * span after streaming completes. No-op when tracing is not initialized.
 */
export async function startCursorTurnSpan(attrs: {
  model: string;
  mode: string;
  sessionId: string;
}): Promise<{ setTokens(input: number, output: number): void; end(): void }> {
  const noop = { setTokens() {}, end() {} };
  try {
    const otelApi = await import("@opentelemetry/api");
    const tracer = otelApi.trace.getTracer("cursor-runner");
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

// Metric names — must match workflow-runner pkg/otel/metrics.go
export const METRIC_LLM_CALL_DURATION = "stigmer.llm.call.duration";
export const METRIC_LLM_CALL_COUNT = "stigmer.llm.call.count";
export const METRIC_LLM_TOKENS_INPUT = "stigmer.llm.tokens.input";
export const METRIC_LLM_TOKENS_OUTPUT = "stigmer.llm.tokens.output";

/**
 * Record cursor turn metrics (duration, call count, token counters).
 * No-op when metrics are not initialized.
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
    const meter = otelApi.metrics.getMeter("cursor-runner");

    const attrs = {
      [ATTR_CURSOR_MODEL]: opts.model,
      [ATTR_CURSOR_MODE]: opts.mode,
    };

    const duration = meter.createHistogram(METRIC_LLM_CALL_DURATION, {
      unit: "ms",
      description: "Duration of LLM API calls in milliseconds",
    });
    duration.record(opts.durationMs, attrs);

    const callCount = meter.createCounter(METRIC_LLM_CALL_COUNT, {
      description: "Total number of LLM API calls",
    });
    callCount.add(1, attrs);

    if (opts.inputTokens) {
      const inputCounter = meter.createCounter(METRIC_LLM_TOKENS_INPUT, {
        unit: "{token}",
        description: "Total input tokens consumed",
      });
      inputCounter.add(opts.inputTokens, attrs);
    }

    if (opts.outputTokens) {
      const outputCounter = meter.createCounter(METRIC_LLM_TOKENS_OUTPUT, {
        unit: "{token}",
        description: "Total output tokens produced",
      });
      outputCounter.add(opts.outputTokens, attrs);
    }
  } catch {
    // Metrics not initialized — silently skip.
  }
}
