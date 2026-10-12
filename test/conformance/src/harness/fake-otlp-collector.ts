// A fake OpenTelemetry collector: OTLP over HTTP with JSON bodies.
// Domain: conformance harness (execution engine, run traces).
//
// The local execution target boots its runner pointed here with
// OTEL_EXPORTER_OTLP_PROTOCOL=http/json, a login header this receiver
// requires, and the conversation's text switched on, so the run-traces suite
// reads every span a run left as a tracing tool would receive it. JSON keeps
// the suite free of a protobuf decoder; the protobuf and gRPC forwards are
// pinned by the runner's own lane tests (agent-proxy/__tests__/
// otlp-forward.test.ts) on the same code. A request without the login is
// answered 401 and recorded as refused, so the suite can prove the agent
// host's spans arrived through the runner, which alone holds the login.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readBody } from "@stigmer/test-support/fake-llm-upstream";

/** The login the runner is given and this receiver requires. */
export const COLLECTOR_LOGIN = "Bearer conformance-collector";

/** One span as received, its attributes flattened to plain values. */
export interface ReceivedSpan {
  readonly traceId: string;
  readonly spanId: string;
  /** Empty for a root span. */
  readonly parentSpanId: string;
  readonly name: string;
  readonly kind: number;
  readonly attributes: Readonly<Record<string, string | number | boolean | readonly unknown[]>>;
  /** The resource's `stigmer.runner.process`, `""` for the runner itself. */
  readonly process: string;
  readonly statusCode: number;
}

interface OtlpAnyValue {
  readonly stringValue?: string;
  readonly intValue?: string | number;
  readonly doubleValue?: number;
  readonly boolValue?: boolean;
  readonly arrayValue?: { readonly values?: readonly OtlpAnyValue[] };
}

interface OtlpKeyValue {
  readonly key: string;
  readonly value: OtlpAnyValue;
}

interface OtlpSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind?: number;
  readonly attributes?: readonly OtlpKeyValue[];
  readonly status?: { readonly code?: number };
}

interface OtlpTraceRequest {
  readonly resourceSpans?: readonly {
    readonly resource?: { readonly attributes?: readonly OtlpKeyValue[] };
    readonly scopeSpans?: readonly { readonly spans?: readonly OtlpSpan[] }[];
  }[];
}

function plain(value: OtlpAnyValue): string | number | boolean | readonly unknown[] {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.intValue !== undefined) return Number(value.intValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.boolValue !== undefined) return value.boolValue;
  return (value.arrayValue?.values ?? []).map(plain);
}

function attributesOf(list: readonly OtlpKeyValue[] | undefined): Record<string, string | number | boolean | readonly unknown[]> {
  return Object.fromEntries((list ?? []).map(({ key, value }) => [key, plain(value)]));
}

export class FakeOtlpCollector {
  private server: Server | undefined;
  private readonly received: ReceivedSpan[] = [];
  private refusedCount = 0;

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
  }

  async close(): Promise<void> {
    const server = this.server;
    if (server === undefined) return;
    this.server = undefined;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }

  /** The endpoint the runner is booted with (`OTEL_EXPORTER_OTLP_ENDPOINT`): the exporter appends `/v1/traces`. */
  endpoint(): string {
    if (this.server === undefined) throw new Error("FakeOtlpCollector.start() must be called before endpoint()");
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  /** Every span received so far. */
  spans(): readonly ReceivedSpan[] {
    return this.received;
  }

  /** The spans of one trace. */
  trace(traceId: string): readonly ReceivedSpan[] {
    return this.received.filter((span) => span.traceId === traceId);
  }

  /** How many exports arrived without the login. */
  refused(): number {
    return this.refusedCount;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    if (req.headers.authorization !== COLLECTOR_LOGIN) {
      this.refusedCount += 1;
      res.writeHead(401).end();
      return;
    }
    if (req.method === "POST" && req.url === "/v1/traces") {
      const request = JSON.parse(body) as OtlpTraceRequest;
      for (const resourceSpans of request.resourceSpans ?? []) {
        const resource = attributesOf(resourceSpans.resource?.attributes);
        const process = typeof resource["stigmer.runner.process"] === "string" ? resource["stigmer.runner.process"] : "";
        for (const scope of resourceSpans.scopeSpans ?? []) {
          for (const span of scope.spans ?? []) {
            this.received.push({
              traceId: span.traceId,
              spanId: span.spanId,
              parentSpanId: span.parentSpanId ?? "",
              name: span.name,
              kind: span.kind ?? 0,
              attributes: attributesOf(span.attributes),
              process,
              statusCode: span.status?.code ?? 0,
            });
          }
        }
      }
    }
    // Metrics and anything else: taken, not read.
    res.writeHead(200, { "content-type": "application/json" }).end("{}");
  }
}
