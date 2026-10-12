/**
 * The local proxy's telemetry lane (`agent-proxy/otlp-forward.ts`, served
 * by `server.ts`), end to end: the agent host's stock OpenTelemetry
 * exporter (`otel-export.ts` `laneSpanExporter`) sends to a real proxy,
 * which forwards to a test collector on loopback.
 *
 * Pinned:
 *  - each protocol reaches its collector with the operator's login and
 *    never the host's token: `http/protobuf` byte for byte what the
 *    OpenTelemetry serializer wrote, `http/json` as OTLP JSON, `grpc` as the
 *    same protobuf message through a real gRPC server, the login in its
 *    metadata;
 *  - admission: the host's token only; the lane's two signal paths only;
 *    POST only; a signal the runner does not export is refused; another
 *    encoding or a compressed body is refused; a body above the bound never
 *    reaches the collector; no live turn is needed;
 *  - a collector's retryable failure is answered 503 after the forward's
 *    own retries, the host's exporter retries in turn, and the export
 *    succeeds once the collector recovers.
 */

import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { Server as GrpcServer, ServerCredentials, type Metadata, type ServerUnaryCall, type sendUnaryData } from "@grpc/grpc-js";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { ProtobufTraceSerializer } from "@opentelemetry/otlp-transformer";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan, type SpanExporter } from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, it } from "vitest";

import { testConfig } from "../../__test-utils__/config-fixture.js";
import { laneSpanExporter, resetTelemetrySettingsForTests, telemetrySettings } from "../../otel-export.js";
import { captureRunnerSecrets, resetRunnerSecretsForTests } from "../../shared/runner-credential-store.js";
import { MAX_OTLP_BODY_BYTES } from "../otlp-forward.js";
import { AgentProxy } from "../server.js";

const HOST_TOKEN = "host-token-0123456789";
const OPERATOR_LOGIN = "Basic abc";
const TRACES_PATH = "/v1/proxy/otlp/v1/traces";

interface Received {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

/** A collector on loopback that records each request and answers with `status()`. */
class TestCollector {
  readonly received: Received[] = [];
  status: () => number = () => 200;
  private server: Server | undefined;

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        this.received.push({ method: req.method ?? "", path: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) });
        res.writeHead(this.status());
        res.end();
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server === undefined) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const ENV_NAMES = [
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_PROTOCOL",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_EXPORTER_OTLP_TIMEOUT",
] as const;
const savedEnv = new Map(ENV_NAMES.map((name) => [name, process.env[name]] as const));
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetRunnerSecretsForTests();
  resetTelemetrySettingsForTests();
});

/** Point the runner at `endpoint` over `protocol` with the operator's login in custody, and start a proxy. */
async function runnerExportingTo(endpoint: string | undefined, protocol: string, extra: Record<string, string> = {}): Promise<AgentProxy> {
  if (endpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = endpoint;
  process.env.OTEL_EXPORTER_OTLP_PROTOCOL = protocol;
  process.env.OTEL_EXPORTER_OTLP_HEADERS = `authorization=${encodeURIComponent(OPERATOR_LOGIN)}`;
  for (const [name, value] of Object.entries(extra)) process.env[name] = value;
  captureRunnerSecrets();
  resetTelemetrySettingsForTests();
  const proxy = await AgentProxy.start(testConfig());
  proxy.authorizeHost(HOST_TOKEN);
  cleanups.push(() => proxy.close());
  return proxy;
}

/** One finished span, as a span processor hands it to an exporter. */
function finishedSpans(name: string): ReadableSpan[] {
  const memory = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(memory)] });
  provider.getTracer("lane-test").startSpan(name).end();
  return memory.getFinishedSpans();
}

function exportVia(exporter: SpanExporter, spans: ReadableSpan[]): Promise<ExportResult> {
  return new Promise((resolve) => exporter.export(spans, resolve));
}

async function hostExporter(proxy: AgentProxy): Promise<SpanExporter> {
  const exporter = await laneSpanExporter(telemetrySettings(), { endpoint: proxy.endpoint, token: HOST_TOKEN });
  cleanups.push(() => exporter.shutdown());
  return exporter;
}

/** A raw request to the proxy, its status, or the socket error that ended it. */
function rawCall(
  proxy: AgentProxy,
  path: string,
  init: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: Buffer } = {},
): Promise<number | string> {
  return new Promise((resolve) => {
    const req = httpRequest(`${proxy.endpoint}${path}`, { method: init.method ?? "POST", headers: init.headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", (err: NodeJS.ErrnoException) => resolve(err.code ?? err.message));
    req.end(init.body);
  });
}

const asHostProtobuf = { authorization: `Bearer ${HOST_TOKEN}`, "content-type": "application/x-protobuf" };

describe("the telemetry lane forwards the host's exports", () => {
  it("over http/protobuf, byte for byte, with the operator's login and never the host's token", async () => {
    const collector = new TestCollector();
    const url = await collector.start();
    cleanups.push(() => collector.stop());
    const proxy = await runnerExportingTo(url, "http/protobuf");
    const spans = finishedSpans("chat claude-sonnet-4-6");

    const result = await exportVia(await hostExporter(proxy), spans);

    expect(result.code).toBe(ExportResultCode.SUCCESS);
    expect(collector.received).toHaveLength(1);
    const [got] = collector.received;
    expect(got!.method).toBe("POST");
    expect(got!.path).toBe("/v1/traces");
    expect(got!.headers["content-type"]).toBe("application/x-protobuf");
    expect(got!.headers.authorization).toBe(OPERATOR_LOGIN);
    expect(JSON.stringify(got!.headers)).not.toContain(HOST_TOKEN);
    expect(got!.body.equals(Buffer.from(ProtobufTraceSerializer.serializeRequest(spans)!))).toBe(true);
  });

  it("over http/json, as OTLP JSON", async () => {
    const collector = new TestCollector();
    const url = await collector.start();
    cleanups.push(() => collector.stop());
    const proxy = await runnerExportingTo(url, "http/json");

    const result = await exportVia(await hostExporter(proxy), finishedSpans("execute_tool read_file"));

    expect(result.code).toBe(ExportResultCode.SUCCESS);
    const [got] = collector.received;
    expect(got!.path).toBe("/v1/traces");
    expect(got!.headers["content-type"]).toBe("application/json");
    expect(got!.headers.authorization).toBe(OPERATOR_LOGIN);
    const parsed = JSON.parse(got!.body.toString("utf8")) as {
      resourceSpans: { scopeSpans: { spans: { name: string }[] }[] }[];
    };
    expect(parsed.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.name).toBe("execute_tool read_file");
  });

  it("over grpc, the same protobuf message through a gRPC collector, the login in its metadata", async () => {
    const calls: { readonly body: Buffer; readonly metadata: Metadata }[] = [];
    const server = new GrpcServer();
    const identity = (value: Buffer): Buffer => value;
    server.register<Buffer, Buffer>(
      "/opentelemetry.proto.collector.trace.v1.TraceService/Export",
      (call: ServerUnaryCall<Buffer, Buffer>, callback: sendUnaryData<Buffer>) => {
        calls.push({ body: call.request, metadata: call.metadata });
        callback(null, Buffer.alloc(0));
      },
      identity,
      identity,
      "unary",
    );
    const port = await new Promise<number>((resolve, reject) =>
      server.bindAsync("127.0.0.1:0", ServerCredentials.createInsecure(), (err, bound) => (err ? reject(err) : resolve(bound))),
    );
    cleanups.push(() => new Promise<void>((resolve) => server.tryShutdown(() => resolve())));
    const proxy = await runnerExportingTo(`http://127.0.0.1:${port}`, "grpc");
    const spans = finishedSpans("invoke_agent support-bot");

    const result = await exportVia(await hostExporter(proxy), spans);

    expect(result.code).toBe(ExportResultCode.SUCCESS);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.equals(Buffer.from(ProtobufTraceSerializer.serializeRequest(spans)!))).toBe(true);
    expect(calls[0]!.metadata.get("authorization")).toEqual([OPERATOR_LOGIN]);
    expect(JSON.stringify(calls[0]!.metadata.toJSON())).not.toContain(HOST_TOKEN);
  });
});

describe("what the telemetry lane takes", () => {
  it("refuses what is not the host's export of a signal the runner exports, and needs no live turn", async () => {
    const collector = new TestCollector();
    const url = await collector.start();
    cleanups.push(() => collector.stop());
    const proxy = await runnerExportingTo(url, "http/protobuf");
    const body = Buffer.from(ProtobufTraceSerializer.serializeRequest(finishedSpans("s"))!);

    expect(await rawCall(proxy, TRACES_PATH, { headers: { "content-type": "application/x-protobuf" }, body }), "no host token").toBe(401);
    expect(await rawCall(proxy, "/v1/proxy/otlp/v1/logs", { headers: asHostProtobuf, body }), "a signal the lane does not serve").toBe(404);
    expect(await rawCall(proxy, TRACES_PATH, { method: "GET", headers: asHostProtobuf }), "not POST").toBe(405);
    expect(await rawCall(proxy, TRACES_PATH, { headers: { ...asHostProtobuf, "content-type": "application/json" }, body }), "another encoding").toBe(415);
    expect(await rawCall(proxy, TRACES_PATH, { headers: { ...asHostProtobuf, "content-encoding": "gzip" }, body }), "compressed").toBe(415);
    expect(collector.received, "nothing refused reached the collector").toHaveLength(0);

    expect(await rawCall(proxy, TRACES_PATH, { headers: asHostProtobuf, body }), "no turn is open on this proxy").toBe(200);
    expect(collector.received).toHaveLength(1);
  });

  it("forwards a batch past 8 MiB, as a raised batch size with content on sends", async () => {
    const collector = new TestCollector();
    const url = await collector.start();
    cleanups.push(() => collector.stop());
    const proxy = await runnerExportingTo(url, "http/protobuf");

    const answer = await rawCall(proxy, TRACES_PATH, { headers: asHostProtobuf, body: Buffer.alloc(9 * 1024 * 1024) });

    expect(answer).toBe(200);
    expect(collector.received).toHaveLength(1);
  });

  it("keeps a body above the bound from the collector", async () => {
    const collector = new TestCollector();
    const url = await collector.start();
    cleanups.push(() => collector.stop());
    const proxy = await runnerExportingTo(url, "http/protobuf");

    const answer = await rawCall(proxy, TRACES_PATH, { headers: asHostProtobuf, body: Buffer.alloc(MAX_OTLP_BODY_BYTES + 1024 * 1024) });

    // Answered, not cut off: the exporter retries a dropped connection, never a 413.
    expect(answer).toBe(413);
    expect(collector.received).toHaveLength(0);
  });

  it("refuses a signal this runner does not export", async () => {
    const proxy = await runnerExportingTo(undefined, "http/protobuf");
    const body = Buffer.from(ProtobufTraceSerializer.serializeRequest(finishedSpans("s"))!);
    expect(await rawCall(proxy, TRACES_PATH, { headers: asHostProtobuf, body })).toBe(404);
  });
});

describe("a collector that fails", () => {
  it(
    "is answered 503 after the forward's retries, the host's exporter retries, and the export succeeds once it recovers",
    async () => {
      const collector = new TestCollector();
      const url = await collector.start();
      cleanups.push(() => collector.stop());
      // A short bound for the forward, so its own retries end quickly (`otlp-forward.ts`).
      const proxy = await runnerExportingTo(url, "http/protobuf", { OTEL_EXPORTER_OTLP_TIMEOUT: "1500" });
      const body = Buffer.from(ProtobufTraceSerializer.serializeRequest(finishedSpans("s"))!);

      collector.status = () => 503;
      expect(await rawCall(proxy, TRACES_PATH, { headers: asHostProtobuf, body })).toBe(503);
      expect(collector.received.length, "the forward retried within its bound").toBeGreaterThanOrEqual(1);

      // Fail the next three hits: more than one forward makes inside its 1.5 s,
      // so the export succeeds only if the host's exporter retries the lane.
      collector.received.length = 0;
      let hits = 0;
      collector.status = () => (++hits <= 3 ? 503 : 200);
      const result = await exportVia(await hostExporter(proxy), finishedSpans("retried"));

      expect(result.code).toBe(ExportResultCode.SUCCESS);
      expect(collector.received.length).toBeGreaterThanOrEqual(4);
    },
    25_000,
  );
});
