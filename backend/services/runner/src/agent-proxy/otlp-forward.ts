/**
 * The local proxy's telemetry lane: the agent host's spans and metrics,
 * forwarded to the operator's collector with the collector's login, which
 * the host never holds.
 *
 * Why a lane: the host holds nothing the agent may not have (#2016), and a
 * collector's login is not the agent's; for a tool like Langfuse it is a
 * key that reads every exported conversation. So the host exports to this
 * runner, as it reaches every other credentialed service, and the runner
 * forwards (`server.ts`, the same door, the same host token).
 *
 * The host's exporters are OpenTelemetry's stock OTLP/HTTP ones
 * (`otel-export.ts` `laneSpanExporter`), protobuf, or JSON when the operator
 * chose `http/json`. The forward sends their body on unchanged through
 * OpenTelemetry's own export delegates, with a serializer that returns its
 * input, so the collector's endpoint, per-signal endpoint, path, login, TLS,
 * compression, timeout and retry follow the standard settings exactly as the
 * runner's own exporters do. gRPC carries the same protobuf message an HTTP
 * export does, so a `grpc` operator's collector receives the host's bytes
 * through the gRPC delegate as they came.
 *
 * Answers, in the shape the host's exporter reads: 200 with an empty export
 * response when the collector took the batch; 503 when it did not, after
 * the delegate's own retries, so the host's exporter retries once more
 * inside its own bound; 404 when this runner exports no such signal; 415
 * for a body in another encoding or compressed; 413 above
 * {@link MAX_OTLP_BODY_BYTES}, after the body has been read to its end and
 * dropped: the exporter streams its body, and a request cut off mid-body
 * reads to it as a dropped connection, which it retries. A failing collector is logged when it starts
 * failing and when it recovers, never per batch, and never a body.
 *
 * No live turn is required: a batch leaves the host on the span
 * processor's schedule, often after its turn has settled. The residual is
 * the proxy's: whoever holds the host's token can also send telemetry,
 * which lands in the operator's collector beside the real spans; it can
 * read nothing back and never reaches the login.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { laneEncoding, collectorHeaders, grpcMetadata, telemetrySettings, type TelemetrySettings, type TelemetrySignal } from "../otel-export.js";
import { LaneRefusal } from "./lanes.js";

/** The largest body the lane accepts: twice the largest batch content export allows (32 spans of 64 KiB, `otel-export.ts`). */
export const MAX_OTLP_BODY_BYTES = 8 * 1024 * 1024;

/** The content type each lane encoding arrives in. */
const CONTENT_TYPE = { protobuf: "application/x-protobuf", json: "application/json" } as const;

/** The gRPC service and method each signal's export is (the OTLP collector protos). */
const GRPC_EXPORT: Readonly<Record<TelemetrySignal, { readonly name: string; readonly path: string }>> = {
  traces: { name: "TraceExportService", path: "/opentelemetry.proto.collector.trace.v1.TraceService/Export" },
  metrics: { name: "MetricsExportService", path: "/opentelemetry.proto.collector.metrics.v1.MetricsService/Export" },
};

/** The path segment the lane serves each signal under, after `/v1/proxy/otlp/`. */
const SIGNAL_PATHS: Readonly<Record<string, TelemetrySignal>> = { "v1/traces": "traces", "v1/metrics": "metrics" };

/** The signal a lane path names, or `undefined` for any other path under the lane. */
export function otlpSignalOf(rest: string): TelemetrySignal | undefined {
  return SIGNAL_PATHS[rest];
}

/**
 * The request's body, or `undefined` when it passed `limit`: the rest is
 * read and dropped rather than the socket closed, so the refusal reaches the
 * exporter as an answer it does not retry (`relay.ts` `readBody` destroys
 * the request, right for a model call, which nothing retries blindly).
 */
function readBoundedBody(req: IncomingMessage, limit: number): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
      else chunks.length = 0;
    });
    req.on("end", () => resolve(size <= limit ? Buffer.concat(chunks) : undefined));
    req.on("error", reject);
  });
}

/** One signal's export delegate: OpenTelemetry's, over bytes already encoded. */
interface ForwardDelegate {
  export(body: Uint8Array, done: (result: { readonly code: number; readonly error?: Error }) => void): void;
  shutdown(): Promise<void>;
}

/** The serializer that sends the host's body on as it came. */
const PASS_THROUGH = {
  serializeRequest: (body: Uint8Array): Uint8Array => body,
  deserializeResponse: (): Record<string, never> => ({}),
};

async function delegateFor(settings: TelemetrySettings, signal: TelemetrySignal): Promise<ForwardDelegate> {
  const protocol = settings[signal].protocol;
  const identifier = signal === "traces" ? "TRACES" : "METRICS";
  const headers = await collectorHeaders(signal);
  if (protocol === "grpc") {
    const { createOtlpGrpcExportDelegate, convertLegacyOtlpGrpcOptions } = await import("@opentelemetry/otlp-grpc-exporter-base");
    return createOtlpGrpcExportDelegate(
      convertLegacyOtlpGrpcOptions({ metadata: await grpcMetadata(headers) }, identifier),
      PASS_THROUGH,
      GRPC_EXPORT[signal].name,
      GRPC_EXPORT[signal].path,
    );
  }
  const { createOtlpHttpExportDelegate, convertLegacyHttpOptions } = await import("@opentelemetry/otlp-exporter-base/node-http");
  return createOtlpHttpExportDelegate(
    convertLegacyHttpOptions({ headers }, identifier, `v1/${signal}`, { "Content-Type": CONTENT_TYPE[laneEncoding(protocol)] }),
    PASS_THROUGH,
  );
}

/** The lane: admission, the body, the forward, the answer. Built once per proxy; delegates are built on first use. */
export class OtlpForward {
  private readonly delegates = new Map<TelemetrySignal, Promise<ForwardDelegate>>();
  private readonly failing = new Set<TelemetrySignal>();

  constructor(private readonly settings: () => TelemetrySettings = telemetrySettings) {}

  /** Serve one export the host's exporter sent; throws a {@link LaneRefusal} for a request the lane does not take. */
  async serve(req: IncomingMessage, res: ServerResponse, signal: TelemetrySignal): Promise<void> {
    if (req.method !== "POST") throw new LaneRefusal(405, "an OTLP export is sent with POST");
    const settings = this.settings();
    if (!settings[signal].enabled) throw new LaneRefusal(404, `this runner exports no ${signal}`);
    const encoding = laneEncoding(settings[signal].protocol);
    const contentType = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
    if (contentType !== CONTENT_TYPE[encoding]) {
      throw new LaneRefusal(415, `this runner forwards ${signal} as ${CONTENT_TYPE[encoding]}, not ${contentType || "an untyped body"}`);
    }
    const contentEncoding = (req.headers["content-encoding"] ?? "identity").trim().toLowerCase();
    if (contentEncoding !== "identity") throw new LaneRefusal(415, "the telemetry lane takes an uncompressed body");
    const body = await readBoundedBody(req, MAX_OTLP_BODY_BYTES);
    if (body === undefined) throw new LaneRefusal(413, `an OTLP export may carry at most ${MAX_OTLP_BODY_BYTES} bytes`);

    const result = await this.forward(signal, body);
    if (result.ok) {
      res.writeHead(200, { "content-type": CONTENT_TYPE[encoding] });
      res.end(encoding === "json" ? "{}" : "");
      return;
    }
    res.writeHead(503, { "content-type": "text/plain" });
    res.end(`the collector did not take the ${signal}: ${result.message}`);
  }

  /** Send one encoded export to the collector; resolves to whether it took it. */
  async forward(signal: TelemetrySignal, body: Uint8Array): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
    let delegate = this.delegates.get(signal);
    if (delegate === undefined) {
      // A delegate that could not be built is built again on the next export.
      delegate = delegateFor(this.settings(), signal).catch((err: unknown) => {
        this.delegates.delete(signal);
        throw err;
      });
      this.delegates.set(signal, delegate);
    }
    const ready = await delegate;
    const { ExportResultCode } = await import("@opentelemetry/core");
    const result = await new Promise<{ readonly code: number; readonly error?: Error }>((resolve) => ready.export(body, resolve));
    if (result.code === ExportResultCode.SUCCESS) {
      if (this.failing.delete(signal)) console.log(`[agent-proxy] the collector takes the agent host's ${signal} again`);
      return { ok: true };
    }
    const message = result.error?.message ?? "the export failed";
    if (!this.failing.has(signal)) {
      this.failing.add(signal);
      console.warn(`[agent-proxy] the collector refused the agent host's ${signal}: ${message}`);
    }
    return { ok: false, message };
  }

  /** Flush and close every delegate. */
  async close(): Promise<void> {
    const delegates = [...this.delegates.values()];
    this.delegates.clear();
    await Promise.all(delegates.map(async (delegate) => (await delegate).shutdown()));
  }
}
