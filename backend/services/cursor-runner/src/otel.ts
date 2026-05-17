/**
 * Env-var-driven OpenTelemetry tracing initialization.
 *
 * Mirrors the workflow-runner pattern (pkg/otel/otel.go): reads
 * OTEL_EXPORTER_OTLP_ENDPOINT and configures an OTLP/gRPC exporter
 * with W3C TraceContext propagation. When the env var is unset,
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
  const { W3CTraceContextPropagator } = await import("@opentelemetry/core");
  const otelApi = await import("@opentelemetry/api");

  const resource = new Resource({ "service.name": serviceName });
  const exporter = new OTLPTraceExporter({ url: endpoint });
  const provider = new NodeTracerProvider({ resource });
  provider.addSpanProcessor(new BatchSpanProcessor(exporter));
  provider.register();

  otelApi.propagation.setGlobalPropagator(new W3CTraceContextPropagator());

  console.log(`OTel tracing enabled (endpoint=${endpoint}, service=${serviceName})`);

  return async () => {
    await provider.shutdown();
  };
}
