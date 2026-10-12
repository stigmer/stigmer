/**
 * The runner's telemetry decision (`otel-export.ts`): which signals export,
 * over which protocol, with or without the conversation's text, and with
 * which batch, all from the standard OpenTelemetry variables; a protocol the
 * standard does not name refuses the start. The agent host adopts the
 * runner's decision and reads no variable of its own. The collector's login
 * comes from the custody store, never from `process.env` after the boot
 * capture. Each protocol builds OpenTelemetry's own exporter, and the host's
 * exporters point at the local proxy's lane.
 */

import { afterEach, describe, expect, it } from "vitest";
import { OTLPTraceExporter as GrpcTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { OTLPTraceExporter as ProtoTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { OTLPTraceExporter as JsonTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter as GrpcMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { OTLPMetricExporter as ProtoMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPMetricExporter as JsonMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";

import {
  CAPTURE_CONTENT_ENV,
  CONTENT_BATCH_SIZE,
  TELEMETRY_OFF,
  adoptTelemetrySettings,
  collectorHeaders,
  collectorMetricExporter,
  collectorSpanExporter,
  contentCaptureOn,
  laneEncoding,
  laneMetricExporter,
  laneSpanExporter,
  laneUrl,
  resetTelemetrySettingsForTests,
  resolveTelemetrySettings,
  telemetrySettings,
  type OtlpProtocol,
  type TelemetrySettings,
} from "../otel-export.js";
import { captureRunnerSecrets, resetRunnerSecretsForTests } from "../shared/runner-credential-store.js";

const ENDPOINT = "http://127.0.0.1:4318";

function settingsWith(protocol: OtlpProtocol): TelemetrySettings {
  return {
    traces: { enabled: true, protocol },
    metrics: { enabled: true, protocol },
    content: false,
    batchSize: null,
  };
}

afterEach(() => {
  resetTelemetrySettingsForTests();
  resetRunnerSecretsForTests();
  for (const name of [
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_EXPORTER_OTLP_HEADERS",
    "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
    "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
  ]) {
    delete process.env[name];
  }
});

describe("resolveTelemetrySettings", () => {
  it("exports nothing without an endpoint", () => {
    const settings = resolveTelemetrySettings({});
    expect(settings.traces.enabled).toBe(false);
    expect(settings.metrics.enabled).toBe(false);
  });

  it("turns both signals on with the general endpoint, on the standard's default protocol", () => {
    const settings = resolveTelemetrySettings({ OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT });
    expect(settings.traces).toEqual({ enabled: true, protocol: "http/protobuf" });
    expect(settings.metrics).toEqual({ enabled: true, protocol: "http/protobuf" });
  });

  it("turns on only the signal whose own endpoint is set", () => {
    const settings = resolveTelemetrySettings({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${ENDPOINT}/v1/traces` });
    expect(settings.traces.enabled).toBe(true);
    expect(settings.metrics.enabled).toBe(false);
  });

  it("takes a signal's own protocol over the general one", () => {
    const settings = resolveTelemetrySettings({
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_EXPORTER_OTLP_PROTOCOL: "grpc",
      OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: "http/json",
    });
    expect(settings.traces.protocol).toBe("grpc");
    expect(settings.metrics.protocol).toBe("http/json");
  });

  it("reads the protocol without case", () => {
    expect(resolveTelemetrySettings({ OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT, OTEL_EXPORTER_OTLP_PROTOCOL: "HTTP/JSON" }).traces.protocol).toBe(
      "http/json",
    );
  });

  it("turns everything off with OTEL_SDK_DISABLED=true", () => {
    const settings = resolveTelemetrySettings({ OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT, OTEL_SDK_DISABLED: "TRUE" });
    expect(settings.traces.enabled).toBe(false);
    expect(settings.metrics.enabled).toBe(false);
  });

  it("refuses a protocol the standard does not name, naming the variable and the three values", () => {
    expect(() => resolveTelemetrySettings({ OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT, OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "grpcx" })).toThrow(
      /OTEL_EXPORTER_OTLP_TRACES_PROTOCOL="grpcx".*grpc, http\/protobuf, http\/json/,
    );
    expect(() => resolveTelemetrySettings({ OTEL_EXPORTER_OTLP_PROTOCOL: "thrift" })).toThrow(/OTEL_EXPORTER_OTLP_PROTOCOL="thrift"/);
  });

  it("sizes the batch for content: 32 with content on, the SDK's own with it off, the operator's batch either way", () => {
    expect(resolveTelemetrySettings({ [CAPTURE_CONTENT_ENV]: "true" }).batchSize).toBe(CONTENT_BATCH_SIZE);
    expect(resolveTelemetrySettings({}).batchSize).toBeNull();
    expect(resolveTelemetrySettings({ [CAPTURE_CONTENT_ENV]: "true", OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "100" }).batchSize).toBe(100);
    expect(resolveTelemetrySettings({ OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "64" }).batchSize).toBe(64);
  });
});

describe("contentCaptureOn", () => {
  it.each(["true", "TRUE", "span_only", "Span_And_Event"])("is on for %s", (value) => {
    expect(contentCaptureOn({ [CAPTURE_CONTENT_ENV]: value })).toBe(true);
  });

  it.each(["", "false", "1", "yes", "event_only"])("is off for %j", (value) => {
    expect(contentCaptureOn({ [CAPTURE_CONTENT_ENV]: value })).toBe(false);
  });

  it("is off when unset", () => {
    expect(contentCaptureOn({})).toBe(false);
  });
});

describe("this process's settings", () => {
  it("resolve from the environment on first read in the runner", () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = ENDPOINT;
    expect(telemetrySettings().traces.enabled).toBe(true);
  });

  it("are the adopted ones in the agent host, whatever its environment says", () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = ENDPOINT;
    adoptTelemetrySettings(TELEMETRY_OFF);
    expect(telemetrySettings()).toBe(TELEMETRY_OFF);
    const runners = settingsWith("grpc");
    adoptTelemetrySettings(runners);
    expect(telemetrySettings()).toBe(runners);
  });

  it("are read again after a reset", () => {
    adoptTelemetrySettings(settingsWith("grpc"));
    resetTelemetrySettingsForTests();
    expect(telemetrySettings().traces.enabled).toBe(false);
  });
});

describe("collectorHeaders", () => {
  it("reads the login from the custody store, the signal's own entries over the general ones, values decoded", async () => {
    process.env.OTEL_EXPORTER_OTLP_HEADERS = "Authorization=Basic%20Z2VuZXJhbA%3D%3D,x-tenant=acme";
    process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS = "x-tenant=traces-tenant";
    captureRunnerSecrets();

    expect(process.env.OTEL_EXPORTER_OTLP_HEADERS).toBeUndefined();
    expect(process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS).toBeUndefined();
    expect(await collectorHeaders("traces")).toEqual({ Authorization: "Basic Z2VuZXJhbA==", "x-tenant": "traces-tenant" });
    expect(await collectorHeaders("metrics")).toEqual({ Authorization: "Basic Z2VuZXJhbA==", "x-tenant": "acme" });
  });

  it("is empty when no login is set", async () => {
    captureRunnerSecrets();
    expect(await collectorHeaders("traces")).toEqual({});
  });
});

describe("the lane", () => {
  it("has a URL per signal under the proxy's otlp root", () => {
    const lane = { endpoint: "http://127.0.0.1:41000/", token: "t" };
    expect(laneUrl(lane, "traces")).toBe("http://127.0.0.1:41000/v1/proxy/otlp/v1/traces");
    expect(laneUrl(lane, "metrics")).toBe("http://127.0.0.1:41000/v1/proxy/otlp/v1/metrics");
  });

  it("carries JSON for http/json and protobuf for the rest", () => {
    expect(laneEncoding("http/json")).toBe("json");
    expect(laneEncoding("http/protobuf")).toBe("protobuf");
    expect(laneEncoding("grpc")).toBe("protobuf");
  });
});

describe("the exporters", () => {
  it.each([
    ["grpc", GrpcTraceExporter, GrpcMetricExporter],
    ["http/protobuf", ProtoTraceExporter, ProtoMetricExporter],
    ["http/json", JsonTraceExporter, JsonMetricExporter],
  ] as const)("are OpenTelemetry's own for %s", async (protocol, spanClass, metricClass) => {
    const spans = await collectorSpanExporter(settingsWith(protocol));
    const metrics = await collectorMetricExporter(settingsWith(protocol));
    expect(spans).toBeInstanceOf(spanClass);
    expect(metrics).toBeInstanceOf(metricClass);
    await spans.shutdown();
    await metrics.shutdown();
  });

  it.each([
    ["http/protobuf", ProtoTraceExporter, ProtoMetricExporter],
    ["grpc", ProtoTraceExporter, ProtoMetricExporter],
    ["http/json", JsonTraceExporter, JsonMetricExporter],
  ] as const)("point the agent host at the lane over HTTP for %s", async (protocol, spanClass, metricClass) => {
    const lane = { endpoint: "http://127.0.0.1:41000", token: "host-token" };
    const spans = await laneSpanExporter(settingsWith(protocol), lane);
    const metrics = await laneMetricExporter(settingsWith(protocol), lane);
    expect(spans).toBeInstanceOf(spanClass);
    expect(metrics).toBeInstanceOf(metricClass);
    await spans.shutdown();
    await metrics.shutdown();
  });
});
