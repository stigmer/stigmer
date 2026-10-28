/**
 * OpenTelemetry tracing and metrics initialization for the runner's own
 * processes.
 *
 * Settings-driven (`otel-export.ts`): a signal is exported when the
 * standard variables turn it on, over the protocol they choose, with W3C
 * TraceContext and Baggage propagation. When nothing turns a signal on,
 * these return null and load no OpenTelemetry package: zero overhead.
 *
 * Two routes. The runner exports to the operator's collector, with the
 * collector's login from the custody store. The agent host exports to the
 * runner's local proxy (`lane`), which forwards to the collector with that
 * login (`agent-proxy/otlp-forward.ts`); the host never holds it.
 *
 * The tracer provider generates a run's trace id from its run id inside a
 * run's execution context (`run-trace-id.ts`), so every turn of a run is
 * one trace.
 *
 * `processRole` tells apart the two processes of one runner (`"agent-host"`
 * for the host that runs the engines, `agent-host/entry.ts`): both export
 * under the runner's service name, and a cumulative series two processes
 * report under one resource would read as one counter going backwards.
 */

import type { TelemetryLane } from "./otel-export.js";

/** The resource attribute that names which of a runner's processes exported a span or a series. */
export const ATTR_RUNNER_PROCESS = "stigmer.runner.process";

/** Who exported, and where to: the role on the resource, and the local proxy's lane for the agent host. */
export interface TelemetryInitOptions {
  readonly processRole?: string;
  /** Export to the runner's local proxy instead of the collector: the agent host's route. */
  readonly lane?: TelemetryLane;
}

function runnerResourceAttributes(serviceName: string, processRole: string | undefined): Record<string, string> {
  return { "service.name": serviceName, ...(processRole ? { [ATTR_RUNNER_PROCESS]: processRole } : {}) };
}

export async function initTracing(serviceName: string, options: TelemetryInitOptions = {}): Promise<(() => Promise<void>) | null> {
  const { telemetrySettings, collectorSpanExporter, laneSpanExporter, contentGuardedExporter } = await import("./otel-export.js");
  const settings = telemetrySettings();
  if (!settings.traces.enabled) {
    return null;
  }

  const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");
  const { BatchSpanProcessor } = await import("@opentelemetry/sdk-trace-base");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  const { W3CTraceContextPropagator, CompositePropagator, W3CBaggagePropagator } = await import("@opentelemetry/core");
  const { RunTraceIdGenerator } = await import("./run-trace-id.js");
  const otelApi = await import("@opentelemetry/api");

  const resource = resourceFromAttributes(runnerResourceAttributes(serviceName, options.processRole));
  const exporter = contentGuardedExporter(
    options.lane ? await laneSpanExporter(settings, options.lane) : await collectorSpanExporter(settings),
    settings.content,
  );
  const provider = new NodeTracerProvider({
    resource,
    idGenerator: new RunTraceIdGenerator(),
    spanProcessors: [
      new BatchSpanProcessor(exporter, settings.batchSize !== null ? { maxExportBatchSize: settings.batchSize } : undefined),
    ],
  });
  provider.register();

  otelApi.propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  );

  console.log(
    `OTel tracing enabled (${options.lane ? "through the runner's local proxy" : `protocol=${settings.traces.protocol}`}, ` +
      `content=${settings.content ? "on" : "off"}, service=${serviceName})`,
  );

  return async () => {
    await provider.shutdown();
  };
}

export async function initMetrics(serviceName: string, options: TelemetryInitOptions = {}): Promise<(() => Promise<void>) | null> {
  const { telemetrySettings, collectorMetricExporter, laneMetricExporter } = await import("./otel-export.js");
  const settings = telemetrySettings();
  if (!settings.metrics.enabled) {
    return null;
  }

  const { MeterProvider, PeriodicExportingMetricReader } = await import("@opentelemetry/sdk-metrics");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  const otelApi = await import("@opentelemetry/api");

  const resource = resourceFromAttributes(runnerResourceAttributes(serviceName, options.processRole));
  const exporter = options.lane ? await laneMetricExporter(settings, options.lane) : await collectorMetricExporter(settings);
  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 30_000,
  });
  const provider = new MeterProvider({ resource, readers: [reader] });

  otelApi.metrics.setGlobalMeterProvider(provider);

  console.log(
    `OTel metrics enabled (${options.lane ? "through the runner's local proxy" : `protocol=${settings.metrics.protocol}`}, service=${serviceName})`,
  );

  return async () => {
    await provider.shutdown();
  };
}

/**
 * Start a runner process's own tracing and metrics, exporting to the
 * collector; resolves to one flush for both, `null` when nothing is exported.
 */
export async function startRunnerTelemetry(serviceName: string): Promise<(() => Promise<void>) | null> {
  const tracing = await initTracing(serviceName);
  const metrics = await initMetrics(serviceName);
  if (!tracing && !metrics) return null;
  return async () => {
    await metrics?.();
    await tracing?.();
  };
}

