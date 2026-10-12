/**
 * Where the runner's telemetry goes, decided once, on the settings every
 * OpenTelemetry user already knows.
 *
 * The runner reads the standard exporter variables and nothing of its own:
 * `OTEL_EXPORTER_OTLP_ENDPOINT` (or a per-signal `..._TRACES_ENDPOINT`,
 * `..._METRICS_ENDPOINT`) turns a signal on, `OTEL_EXPORTER_OTLP_PROTOCOL`
 * (and its per-signal forms) chooses `grpc`, `http/protobuf` or `http/json`,
 * and `OTEL_SDK_DISABLED=true` turns everything off. With no protocol set the
 * standard's default applies, `http/protobuf`, so following any tracing
 * tool's instructions gives a working export; a collector reached on its
 * gRPC port needs `OTEL_EXPORTER_OTLP_PROTOCOL=grpc`. A protocol the
 * standard does not name refuses the runner's start, with one sentence
 * naming the variable and the three values, as a bad model backend does
 * (`shared/llm-backend.ts`).
 *
 * The exporters are OpenTelemetry's own, built with no URL of ours, so each
 * applies the standard's endpoint, per-signal endpoint, `/v1/traces` path,
 * timeout, compression and TLS rules exactly as any OpenTelemetry SDK would.
 * The one thing handed to them is the collector's login: the
 * `OTEL_EXPORTER_OTLP_HEADERS` variables are runner secrets
 * (`shared/runner-credential-keys.ts`), moved out of `process.env` at boot,
 * so they are read from the custody store and passed as headers (gRPC
 * metadata), the per-signal form over the general one, parsed by the
 * standard's `key=value,...` rule.
 *
 * The content switch is the conventions' own,
 * `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`: off unless it is
 * `true`, `span_only` or `span_and_event`. With content on, a span carries
 * up to 64 KiB of text (`shared/telemetry-content.ts`), so the span
 * processor's batch defaults to 32 spans, about 2 MiB, under the 4 MiB a
 * gRPC collector accepts by default; `OTEL_BSP_MAX_EXPORT_BATCH_SIZE`
 * still wins.
 *
 * The agent host reads none of this. The runner resolves one
 * {@link TelemetrySettings} and hands it to the host with its configuration
 * (`agent-host/protocol.ts` `HostConfigWire`); the host adopts it
 * ({@link adoptTelemetrySettings}) and exports to the runner's local proxy,
 * never to the collector ({@link laneSpanExporter}): the host holds nothing
 * the agent may not have, and a collector's login is not the agent's
 * (`agent-proxy/otlp-forward.ts`).
 *
 * Every exporter package loads lazily: a runner with no endpoint set loads
 * none of them.
 */

import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import type { PushMetricExporter } from "@opentelemetry/sdk-metrics";

import { getRunnerSecret } from "./shared/runner-credential-store.js";

/** The three OTLP transports the standard names (`OTEL_EXPORTER_OTLP_PROTOCOL`). */
export type OtlpProtocol = "grpc" | "http/protobuf" | "http/json";

/** The two signals the runner exports. */
export type TelemetrySignal = "traces" | "metrics";

const OTLP_PROTOCOLS: readonly OtlpProtocol[] = ["grpc", "http/protobuf", "http/json"];

/** The standard's default when no protocol is set. */
export const DEFAULT_OTLP_PROTOCOL: OtlpProtocol = "http/protobuf";

/** The conventions' switch for exporting the conversation's text. */
export const CAPTURE_CONTENT_ENV = "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT";

/** The values of {@link CAPTURE_CONTENT_ENV} that mean on, compared without case. */
const CONTENT_ON_VALUES: ReadonlySet<string> = new Set(["true", "span_only", "span_and_event"]);

/** The span processor's batch with content on: 32 spans of at most 64 KiB stay under gRPC's 4 MiB message. */
export const CONTENT_BATCH_SIZE = 32;

/**
 * What the runner decided about telemetry, once: whether each signal is
 * exported, over which protocol, whether the conversation's text rides the
 * spans, and the span processor's batch. Plain data: it crosses the agent
 * host's pipe as it is.
 */
export interface TelemetrySettings {
  readonly traces: { readonly enabled: boolean; readonly protocol: OtlpProtocol };
  readonly metrics: { readonly enabled: boolean; readonly protocol: OtlpProtocol };
  readonly content: boolean;
  /** The span processor's batch size, `null` for the SDK's own (512). */
  readonly batchSize: number | null;
}

/** No signal exported, no content. */
export const TELEMETRY_OFF: TelemetrySettings = {
  traces: { enabled: false, protocol: DEFAULT_OTLP_PROTOCOL },
  metrics: { enabled: false, protocol: DEFAULT_OTLP_PROTOCOL },
  content: false,
  batchSize: null,
};

/** The upper-case signal name the standard's per-signal variables use. */
function signalVariable(signal: TelemetrySignal): "TRACES" | "METRICS" {
  return signal === "traces" ? "TRACES" : "METRICS";
}

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** A signal's protocol: its own variable, else the general one, else the default; anything else refused. */
function protocolOf(env: NodeJS.ProcessEnv, signal: TelemetrySignal): OtlpProtocol {
  const specific = `OTEL_EXPORTER_OTLP_${signalVariable(signal)}_PROTOCOL`;
  const [name, raw] =
    present(env[specific]) !== undefined
      ? [specific, present(env[specific])!]
      : ["OTEL_EXPORTER_OTLP_PROTOCOL", present(env.OTEL_EXPORTER_OTLP_PROTOCOL)];
  if (raw === undefined) return DEFAULT_OTLP_PROTOCOL;
  const value = raw.toLowerCase();
  if ((OTLP_PROTOCOLS as readonly string[]).includes(value)) return value as OtlpProtocol;
  throw new Error(`${name}="${raw}" is not an OTLP protocol. Set it to one of ${OTLP_PROTOCOLS.join(", ")}, or leave it unset for ${DEFAULT_OTLP_PROTOCOL}.`);
}

/** Whether a signal's own endpoint (`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `..._METRICS_ENDPOINT`) is set. */
function signalEndpointSet(env: NodeJS.ProcessEnv, signal: TelemetrySignal): boolean {
  return present(env[`OTEL_EXPORTER_OTLP_${signalVariable(signal)}_ENDPOINT`]) !== undefined;
}

/** Whether the operator switched the conversation's text on. */
export function contentCaptureOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return CONTENT_ON_VALUES.has(present(env[CAPTURE_CONTENT_ENV])?.toLowerCase() ?? "");
}

/**
 * Resolve the settings from the standard variables. Throws on a protocol
 * the standard does not name, which is the runner's start refused.
 */
export function resolveTelemetrySettings(env: NodeJS.ProcessEnv = process.env): TelemetrySettings {
  const disabled = present(env.OTEL_SDK_DISABLED)?.toLowerCase() === "true";
  const general = present(env.OTEL_EXPORTER_OTLP_ENDPOINT) !== undefined;
  const signal = (name: TelemetrySignal): TelemetrySettings["traces"] => ({
    enabled: !disabled && (general || signalEndpointSet(env, name)),
    protocol: protocolOf(env, name),
  });
  const content = contentCaptureOn(env);
  const configuredBatch = Number.parseInt(present(env.OTEL_BSP_MAX_EXPORT_BATCH_SIZE) ?? "", 10);
  return {
    traces: signal("traces"),
    metrics: signal("metrics"),
    content,
    batchSize: configuredBatch > 0 ? configuredBatch : content ? CONTENT_BATCH_SIZE : null,
  };
}

let adopted: TelemetrySettings | undefined;

/**
 * This process's settings: in the runner, resolved from its environment on
 * first read; in the agent host, the runner's, once adopted.
 */
export function telemetrySettings(): TelemetrySettings {
  adopted ??= resolveTelemetrySettings();
  return adopted;
}

/** Take the runner's settings as this process's own: the agent host's start, and tests. */
export function adoptTelemetrySettings(settings: TelemetrySettings): void {
  adopted = settings;
}

/** Test-only: forget the adopted settings, so the next read resolves the environment again. */
export function resetTelemetrySettingsForTests(): void {
  adopted = undefined;
}

/**
 * The collector's login for `signal`, from the custody store: the general
 * `OTEL_EXPORTER_OTLP_HEADERS` with the per-signal form's entries over it,
 * each parsed by the standard's `key=value,...` rule (values URL-decoded).
 */
export async function collectorHeaders(signal: TelemetrySignal): Promise<Record<string, string>> {
  const { parseKeyPairsIntoRecord } = await import("@opentelemetry/core");
  return {
    ...parseKeyPairsIntoRecord(getRunnerSecret("OTEL_EXPORTER_OTLP_HEADERS")),
    ...parseKeyPairsIntoRecord(getRunnerSecret(`OTEL_EXPORTER_OTLP_${signalVariable(signal)}_HEADERS`)),
  };
}

/** gRPC metadata carrying `headers`, for the gRPC exporters and the forward. */
export async function grpcMetadata(headers: Readonly<Record<string, string>>): Promise<import("@grpc/grpc-js").Metadata> {
  const { Metadata } = await import("@grpc/grpc-js");
  const metadata = new Metadata();
  for (const [key, value] of Object.entries(headers)) metadata.set(key, value);
  return metadata;
}

/** The runner's own span exporter to the operator's collector, on the traces protocol. */
export async function collectorSpanExporter(settings: TelemetrySettings): Promise<SpanExporter> {
  const headers = await collectorHeaders("traces");
  switch (settings.traces.protocol) {
    case "grpc": {
      const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-grpc");
      return new OTLPTraceExporter({ metadata: await grpcMetadata(headers) });
    }
    case "http/protobuf": {
      const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-proto");
      return new OTLPTraceExporter({ headers });
    }
    case "http/json": {
      const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
      return new OTLPTraceExporter({ headers });
    }
  }
}

/** The runner's own metric exporter to the operator's collector, on the metrics protocol. */
export async function collectorMetricExporter(settings: TelemetrySettings): Promise<PushMetricExporter> {
  const headers = await collectorHeaders("metrics");
  switch (settings.metrics.protocol) {
    case "grpc": {
      const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-grpc");
      return new OTLPMetricExporter({ metadata: await grpcMetadata(headers) });
    }
    case "http/protobuf": {
      const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-proto");
      return new OTLPMetricExporter({ headers });
    }
    case "http/json": {
      const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-http");
      return new OTLPMetricExporter({ headers });
    }
  }
}

// ─── The agent host's route: the runner's local proxy ──────────────────────

/** The local proxy's telemetry lane, under its root (`agent-proxy/server.ts`). */
export const OTLP_LANE_PREFIX = "/v1/proxy/otlp/";

/** Where the host's exporters send: the runner's local proxy and the host's token there. */
export interface TelemetryLane {
  readonly endpoint: string;
  readonly token: string;
}

/**
 * The host's bound on one export. Longer than the standard's 10-second
 * default, because the runner's forward retries a collector's retryable
 * failure inside its own 10 seconds before it answers.
 */
export const LANE_EXPORT_TIMEOUT_MS = 30_000;

/**
 * The body encoding a signal crosses the lane in: JSON when the operator
 * chose `http/json`, protobuf otherwise. gRPC carries the same protobuf
 * message an HTTP export does, so the forward sends the host's bytes on as
 * they are, whichever protocol reaches the collector.
 */
export function laneEncoding(protocol: OtlpProtocol): "json" | "protobuf" {
  return protocol === "http/json" ? "json" : "protobuf";
}

/** The lane's URL for one signal. */
export function laneUrl(lane: TelemetryLane, signal: TelemetrySignal): string {
  return `${lane.endpoint.replace(/\/+$/, "")}${OTLP_LANE_PREFIX}v1/${signal}`;
}

/** What every lane exporter is built with: the lane's URL, the host's token, no compression, the host's bound. */
async function laneOptions(lane: TelemetryLane, signal: TelemetrySignal) {
  const { CompressionAlgorithm } = await import("@opentelemetry/otlp-exporter-base");
  return {
    url: laneUrl(lane, signal),
    headers: { authorization: `Bearer ${lane.token}` },
    // The forward sends the bytes on unchanged and lets its own exporter
    // compress as the operator chose; a compressed body here would be
    // compressed twice, so the lane takes it plain.
    compression: CompressionAlgorithm.NONE,
    timeoutMillis: LANE_EXPORT_TIMEOUT_MS,
  };
}

/** The agent host's span exporter: OpenTelemetry's own, pointed at the lane. */
export async function laneSpanExporter(settings: TelemetrySettings, lane: TelemetryLane): Promise<SpanExporter> {
  if (laneEncoding(settings.traces.protocol) === "json") {
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    return new OTLPTraceExporter(await laneOptions(lane, "traces"));
  }
  const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-proto");
  return new OTLPTraceExporter(await laneOptions(lane, "traces"));
}

/** The agent host's metric exporter: OpenTelemetry's own, pointed at the lane. */
export async function laneMetricExporter(settings: TelemetrySettings, lane: TelemetryLane): Promise<PushMetricExporter> {
  if (laneEncoding(settings.metrics.protocol) === "json") {
    const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-http");
    return new OTLPMetricExporter(await laneOptions(lane, "metrics"));
  }
  const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-proto");
  return new OTLPMetricExporter(await laneOptions(lane, "metrics"));
}

// ─── The content switch, at the door ───────────────────────────────────────

/**
 * With content off, no span leaves this process carrying a failure's text:
 * every span's `exception` events and status message are dropped at the
 * exporter, whatever instrumentation recorded them. Stigmer's own spans set
 * none with content off (`shared/telemetry-content.ts` `markFailed`); this
 * holds the switch for the spans other libraries record through the global
 * tracer, the Cursor SDK's own and Temporal's among them, whose errors can
 * quote what a call was given. With content on, spans pass as they are.
 */
export function contentGuardedExporter(exporter: SpanExporter, content: boolean): SpanExporter {
  if (content) return exporter;
  return {
    export: (spans, done) => exporter.export(spans.map(withoutFailureText), done),
    shutdown: () => exporter.shutdown(),
    ...(exporter.forceFlush ? { forceFlush: () => exporter.forceFlush!() } : {}),
  };
}

/** `span` seen with no exception events and no status message; every other field read through to it. */
function withoutFailureText(span: ReadableSpan): ReadableSpan {
  const hasException = span.events.some((event) => event.name === "exception");
  if (!hasException && span.status.message === undefined) return span;
  const view: ReadableSpan = Object.create(span) as ReadableSpan;
  Object.defineProperties(view, {
    events: { value: span.events.filter((event) => event.name !== "exception") },
    status: { value: { code: span.status.code } },
  });
  return view;
}
