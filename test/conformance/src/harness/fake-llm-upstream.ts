// A programmable fake LLM PROVIDER behind the server's side-channel proxy.
// Domain: conformance harness (cloud-capability fixtures, E1).
//
// MockLlmProxy stands in for the proxy the runner dials. This fixture stands
// in for the provider the PROXY dials: the server under test is booted with
// its openai and anthropic base URLs pointed here, the proxy suites call the
// server's /v1/proxy/llm/{provider}/... lanes, and what arrives on this side
// is exactly what the proxy forwarded — the injected provider key, the
// stripped hop-by-hop headers, the `stream_options.include_usage` the proxy
// adds to OpenAI chat completions. The suites script what the provider says
// back (a usage-bearing SSE stream, a plain JSON body, a 4xx/5xx with a
// provider-shaped error, a stream cut mid-way) and then assert both the bytes
// the proxy relayed and the usage row it recorded in the billing ledger.
//
// Provider is decided by PATH, since both base URLs point here:
//   POST /v1/messages          → Anthropic (SSE when `stream: true`, else JSON)
//   POST /v1/chat/completions  → OpenAI    (SSE when `stream: true`, else JSON)
// Anything else answers 404 with a loud body — a lane the suite did not mean
// to exercise must fail legibly, never consume a queued turn.
//
// Shared-across-files discipline: the cloud environment (and this fixture)
// boots ONCE per run in vitest's global setup while suites run in forked
// workers, so scripting happens over the control API in cloud-fixtures.ts,
// and every suite resets in afterEach (the MockLlmProxy rule).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import {
  writeAnthropicSseEvents,
  writeJson,
  writeOpenAiSse,
  type AnthropicMessageBody,
  type OpenAiChatCompletionBody,
} from "./llm-wire";

// One scripted provider answer. Exactly one shape per entry; the fixture
// answers whatever provider path the next request arrives on, so a script
// enqueues in the order the suite will call.
export type UpstreamScript =
  // `headers` ride the 200 so a suite can see which upstream headers the
  // proxy relays (provider x-* headers) and which it strips (hop-by-hop).
  | { kind: "anthropic"; body: AnthropicMessageBody; delayMs?: number; headers?: Record<string, string> }
  | { kind: "openai"; body: OpenAiChatCompletionBody; includeUsage?: boolean; delayMs?: number; headers?: Record<string, string> }
  // A provider error: status, JSON body and headers relayed by the proxy or
  // classified by it (Anthropic 400 billing text, OpenAI 429
  // insufficient_quota, 401/403 → the proxy's 503 rewrite).
  | { kind: "error"; status: number; body: unknown; headers?: Record<string, string> }
  // Anthropic stream cut after N SSE events with the socket destroyed — the
  // upstream-aborted-mid-stream arm.
  | { kind: "abort-mid-stream"; body: AnthropicMessageBody; afterEvents: number };

// Everything the provider saw: enough to assert what the proxy forwarded and
// what it did not (secrets, hop-by-hop headers).
export interface CapturedUpstreamRequest {
  readonly provider: "anthropic" | "openai" | "unknown";
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly rawBody: string;
}

export class FakeLlmUpstream {
  private server: Server | undefined;
  private scripts: UpstreamScript[] = [];
  private captured: CapturedUpstreamRequest[] = [];
  private consumed = 0;

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

  url(): string {
    if (this.server === undefined) throw new Error("FakeLlmUpstream.start() must be called before url()");
    const address = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  enqueue(script: UpstreamScript): this {
    this.scripts.push(script);
    return this;
  }

  requests(): readonly CapturedUpstreamRequest[] {
    return this.captured;
  }

  reset(): void {
    this.scripts = [];
    this.captured = [];
    this.consumed = 0;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawBody = await readBody(req);
    const path = new URL(req.url ?? "/", "http://fake").pathname;
    const provider = path === "/v1/messages" ? "anthropic" : path === "/v1/chat/completions" ? "openai" : "unknown";
    this.captured.push({
      provider,
      method: req.method ?? "",
      path,
      headers: flattenHeaders(req),
      body: parseJsonOrUndefined(rawBody),
      rawBody,
    });

    if (provider === "unknown") {
      writeJson(res, 404, { error: `FakeLlmUpstream: unhandled path ${path}` });
      return;
    }
    const next = this.scripts.shift();
    if (next === undefined) {
      writeJson(res, 500, { error: `FakeLlmUpstream: no queued response (consumed ${this.consumed})` });
      return;
    }
    this.consumed += 1;

    const wantsStream = isStreamingRequest(rawBody);
    switch (next.kind) {
      case "anthropic": {
        if (next.delayMs !== undefined) await delay(next.delayMs);
        if (res.destroyed) return;
        if (wantsStream) {
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", ...(next.headers ?? {}) });
          writeAnthropicSseEvents(res, next.body);
          res.end();
        } else {
          writeJson(res, 200, next.body, next.headers ?? {});
        }
        return;
      }
      case "openai": {
        if (next.delayMs !== undefined) await delay(next.delayMs);
        if (res.destroyed) return;
        if (wantsStream) {
          writeOpenAiSse(res, next.body, next.includeUsage ?? true);
        } else {
          writeJson(res, 200, next.body);
        }
        return;
      }
      case "error": {
        writeJson(res, next.status, next.body, next.headers ?? {});
        return;
      }
      case "abort-mid-stream": {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        // Flush the head and the partial body on their own turn of the event
        // loop so the client has SEEN a 200 and some frames before the socket
        // dies — a mid-stream break, not a connection refused. Destroy, never
        // end: the proxy must see a broken upstream, not a short-but-clean
        // stream.
        res.flushHeaders();
        writeAnthropicSseEvents(res, next.body, next.afterEvents);
        await new Promise<void>((resolve) => setImmediate(resolve));
        res.destroy();
        return;
      }
      default: {
        const exhaustive: never = next;
        throw new Error(`unknown upstream script: ${JSON.stringify(exhaustive)}`);
      }
    }
  }
}

function isStreamingRequest(rawBody: string): boolean {
  const body = parseJsonOrUndefined(rawBody);
  return typeof body === "object" && body !== null && (body as { stream?: unknown }).stream === true;
}

function parseJsonOrUndefined(raw: string): unknown {
  if (raw === "") return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function flattenHeaders(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}

export async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
