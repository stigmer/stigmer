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
  const { Resource } = await import("@opentelemetry/resources");
  const { W3CTraceContextPropagator, CompositePropagator } = await import("@opentelemetry/core");
  const { W3CBaggagePropagator } = await import("@opentelemetry/core");
  const otelApi = await import("@opentelemetry/api");

  const resource = new Resource({ "service.name": serviceName });
  const exporter = new OTLPTraceExporter({ url: endpoint });
  const provider = new NodeTracerProvider({ resource });
  provider.addSpanProcessor(new BatchSpanProcessor(exporter));
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
    let bag = otelApi.propagation.getBaggage(ctx) ?? otelApi.createBaggage();
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
