// The e2e control layer over test/support's mock LLM proxy.
// Domain: e2e harness (web console against a live backend stack).
//
// An AgentExecution runs a real LLM loop inside the runner, so the console can
// reach an approval gate without a live model only if something stands in for
// the provider. That stand-in is test/support's MockLlmProxy, the one the
// conformance execution suites script: the runner is pointed at it through
// STIGMER_PROXY_ENDPOINT, it replays canned Anthropic turns from one FIFO,
// answers the background session-title call out of band by its signature, and
// refuses any other provider's path loudly.
//
// What is e2e's own here is the HTTP CONTROL API. Conformance programs the
// proxy by method calls because it lives in the test's process. In Playwright
// the proxy lives in the globalSetup (main) process while specs run in worker
// processes, so a worker programs it over HTTP, at the control URL global
// setup writes to the e2e state file (helpers/mock-llm-control.ts is the
// client):
//   POST /__mock/enqueue    one turn: a bare Anthropic body, or { body, delayMs }
//   POST /__mock/reset      drop every unconsumed turn and the captured requests
//   GET  /__mock/remaining  { remaining }: turns still queued
//   GET  /__mock/requests   { requests }: what the model received, each with the
//                           disposition the proxy decided (scripted, out-of-band,
//                           fenced, unscripted)
// The control routes listen on their own port, as the cloud fixtures' control
// API does, so the runner can never wander onto a control path.
//
// Because the queue is one shared FIFO, the approval specs run serially and
// reset between tests (see playwright.config.ts `interactive-approval`).
import { appendFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { MockLlmProxy, type AnthropicMessageBody } from "@stigmer/test-support/mock-llm";
import { diagEnabled, diagLogPath } from "./diag";

// The turn builders the helpers script with, from the one wire module the
// proxy streams.
export {
  anthropicText,
  anthropicToolUses,
  type AnthropicContentBlock,
  type AnthropicMessageBody,
  type ToolUseBlock,
} from "@stigmer/test-support/mock-llm";

/** Where the runner and the specs reach the running proxy. */
export interface MockLlmEndpoints {
  /** The runner's STIGMER_PROXY_ENDPOINT. */
  readonly proxyUrl: string;
  /** The control API's base URL, written to the e2e state file. */
  readonly controlUrl: string;
}

// The body of POST /__mock/enqueue: the original bare wire shape, still sent
// by the approval helpers, or an envelope carrying a serve delay.
type EnqueueRequest = AnthropicMessageBody | { body: AnthropicMessageBody; delayMs?: number };

class MockLlmControl {
  private readonly proxy = new MockLlmProxy();
  private control: Server | undefined;

  async start(): Promise<MockLlmEndpoints> {
    await this.proxy.start();
    const control = createServer((req, res) => {
      this.handle(req, res).catch((error: unknown) => {
        // A malformed control request fails that request, never the server
        // other specs still depend on.
        if (!res.headersSent) writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
        else if (!res.writableEnded) res.destroy();
      });
    });
    await new Promise<void>((resolve) => control.listen(0, "127.0.0.1", resolve));
    this.control = control;
    const { port } = control.address() as AddressInfo;
    return { proxyUrl: this.proxy.url(), controlUrl: `http://127.0.0.1:${port}` };
  }

  async close(): Promise<void> {
    if (diagEnabled()) this.writeDiagLog();
    const control = this.control;
    this.control = undefined;
    if (control !== undefined) await new Promise<void>((resolve) => control.close(() => resolve()));
    await this.proxy.close();
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = req.url ?? "";
    if (req.method === "POST" && path === "/__mock/enqueue") {
      const parsed = JSON.parse(await readBody(req)) as EnqueueRequest;
      if ("body" in parsed) this.proxy.enqueue(parsed.body, { delayMs: parsed.delayMs ?? 0 });
      else this.proxy.enqueue(parsed);
      writeJson(res, 200, { ok: true, remaining: this.proxy.remaining() });
      return;
    }
    if (req.method === "POST" && path === "/__mock/reset") {
      if (diagEnabled()) this.writeDiagLog();
      this.proxy.reset();
      writeJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && path === "/__mock/remaining") {
      writeJson(res, 200, { remaining: this.proxy.remaining() });
      return;
    }
    if (req.method === "GET" && path === "/__mock/requests") {
      writeJson(res, 200, { requests: this.proxy.requests() });
      return;
    }
    writeJson(res, 404, { error: `MockLlmProxy control: unknown path ${req.method} ${path}` });
  }

  // STIGMER_E2E_DIAG (fixtures/diag.ts): every request the proxy answered since
  // the last reset, in arrival order, one line each, appended before the reset
  // drops them. The shared proxy records no arrival time, so each block is
  // stamped once with the time it was flushed (a reset or the teardown), and
  // the stream flag is read from the captured body.
  private writeDiagLog(): void {
    try {
      const requests = this.proxy.requests();
      if (requests.length === 0) return;
      const lines = [`--- flushed ${new Date().toISOString()}: ${requests.length} request(s), ${this.proxy.remaining()} turn(s) still queued\n`];
      for (const request of requests) {
        const streaming = typeof request.body === "object" && request.body !== null && (request.body as { stream?: unknown }).stream === true;
        lines.push(`LLM path=${request.path} streaming=${streaming} served=${request.disposition}\n`);
      }
      appendFileSync(diagLogPath("mock"), lines.join(""));
    } catch {
      // Diagnostics never fail the stack they observe.
    }
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// ---------------------------------------------------------------------------
// Process singleton — shared by global-setup and global-teardown
// ---------------------------------------------------------------------------
//
// Playwright runs globalSetup and globalTeardown in the SAME (main) process, so
// a module-level singleton survives between them. global-setup starts the proxy
// (handing its URL to the runner); global-teardown closes it.

let singleton: { readonly control: MockLlmControl; readonly endpoints: MockLlmEndpoints } | undefined;

/** Starts the singleton proxy and its control API (idempotent within a run). */
export async function startMockLlmProxy(): Promise<MockLlmEndpoints> {
  if (singleton === undefined) {
    const control = new MockLlmControl();
    if (diagEnabled()) writeFileSync(diagLogPath("mock"), "");
    singleton = { control, endpoints: await control.start() };
  }
  return singleton.endpoints;
}

/** Closes and clears the singleton, if one was started. No-op otherwise. */
export async function stopMockLlmProxy(): Promise<void> {
  const running = singleton;
  singleton = undefined;
  await running?.control.close();
}
