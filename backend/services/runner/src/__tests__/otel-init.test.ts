/**
 * Telemetry initialization (`otel.ts`): the resource a runner's processes
 * export under. The runner and its agent host export under one service
 * name, so the host names its role on the resource; without it, a
 * cumulative series both processes report would read as one counter going
 * backwards.
 *
 * The OpenTelemetry SDKs are replaced at their module seams; what is pinned
 * is the resource each provider is given, and that no exporter is set up
 * without an endpoint.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const resources = vi.hoisted(() => [] as Record<string, string>[]);

vi.mock("@opentelemetry/resources", () => ({
  resourceFromAttributes: (attributes: Record<string, string>) => {
    resources.push(attributes);
    return { attributes };
  },
}));
vi.mock("@opentelemetry/sdk-trace-node", () => ({
  NodeTracerProvider: class {
    register(): void {}
    async shutdown(): Promise<void> {}
  },
}));
vi.mock("@opentelemetry/sdk-trace-base", () => ({ BatchSpanProcessor: class {} }));
vi.mock("@opentelemetry/exporter-trace-otlp-grpc", () => ({ OTLPTraceExporter: class {} }));
vi.mock("@opentelemetry/exporter-metrics-otlp-grpc", () => ({ OTLPMetricExporter: class {} }));
vi.mock("@opentelemetry/sdk-metrics", () => ({
  MeterProvider: class {
    async shutdown(): Promise<void> {}
  },
  PeriodicExportingMetricReader: class {},
}));
vi.mock("@opentelemetry/core", () => ({
  W3CTraceContextPropagator: class {},
  W3CBaggagePropagator: class {},
  CompositePropagator: class {},
}));
vi.mock("@opentelemetry/api", () => ({
  propagation: { setGlobalPropagator: () => {} },
  metrics: { setGlobalMeterProvider: () => {} },
}));

import { ATTR_RUNNER_PROCESS, initMetrics, initTracing } from "../otel.js";

afterEach(() => {
  resources.length = 0;
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  vi.restoreAllMocks();
});

describe("telemetry initialization", () => {
  it("names the agent host's role on the resource of its spans and its metrics", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:4317";
    vi.spyOn(console, "log").mockImplementation(() => {});

    const tracing = await initTracing("stigmer-runner", "agent-host");
    const metrics = await initMetrics("stigmer-runner", "agent-host");
    await tracing?.();
    await metrics?.();

    expect(resources).toEqual([
      { "service.name": "stigmer-runner", [ATTR_RUNNER_PROCESS]: "agent-host" },
      { "service.name": "stigmer-runner", [ATTR_RUNNER_PROCESS]: "agent-host" },
    ]);
  });

  it("keeps the runner's own resource as it was", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:4317";
    vi.spyOn(console, "log").mockImplementation(() => {});

    await initTracing("stigmer-runner");
    expect(resources).toEqual([{ "service.name": "stigmer-runner" }]);
  });

  it("sets up nothing without an endpoint", async () => {
    expect(await initTracing("stigmer-runner", "agent-host")).toBeNull();
    expect(await initMetrics("stigmer-runner", "agent-host")).toBeNull();
    expect(resources).toEqual([]);
  });
});
