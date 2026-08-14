// A programmable mock LLM proxy for the deterministic HITL approval e2e.
// Domain: e2e harness (web console against a live backend stack).
//
// An AgentExecution runs a real LLM loop inside the runner, so the only way to
// drive the web console to an approval gate without a live model — and without
// the flakiness a real model brings — is to stand in for the upstream provider.
// The runner is pointed at this proxy via STIGMER_PROXY_ENDPOINT (a base-URL
// override, NOT a "mock" model name) and it replays canned Anthropic responses
// as Server-Sent Events that the runner's @langchain/anthropic streaming parser
// accepts. No API keys, no network. This mirrors the proven conformance proxy
// (test/conformance/src/harness/mock-llm.ts).
//
// What is NEW here vs. conformance: a small HTTP CONTROL API. The conformance
// proxy is programmed by direct method calls because the proxy and the test run
// in the same process. In Playwright the proxy lives in the globalSetup (main)
// process while specs run in separate worker processes, so a worker cannot call
// `enqueue()` directly. The control routes (`POST /__mock/enqueue`,
// `POST /__mock/reset`, `GET /__mock/remaining`) let a worker program the same
// proxy instance over HTTP, using the control URL persisted to the e2e state
// file. The LLM-serving routes the runner hits (`/v1/messages`,
// `/v1/proxy/llm/...`) and the control routes share one server but never collide
// (distinct path prefixes).
//
// Because the queue is a single shared FIFO, the approval specs run serially and
// reset() between tests (see playwright.config.ts `interactive-approval`).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { appendFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { diagEnabled, diagLogPath } from "./diag";

// Records every LLM call the runner makes to /tmp/stigmer-e2e-mock.log when
// STIGMER_E2E_DIAG is set. The intermittent HITL flake is a post-approval resume
// that doesn't reach a terminal phase; this log is the cheapest way to see, on a
// captured failure, whether the runner ever requested the post-approval
// terminating turn (and what was served). Off by default — pure diagnostics.
function appendMockLog(line: string): void {
  if (!diagEnabled()) return;
  appendFileSync(diagLogPath("mock"), line);
}

// An Anthropic message body, in the shape the provider's `messages` endpoint
// returns. The SSE encoder expands this into the streaming event sequence.
export interface AnthropicMessageBody {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

// One queued turn: a success body to stream, optionally after a serve delay.
// The delay exists for phase-window assertions (sidebar "Running", composer
// disabled mid-execution): a zero-latency mock completes executions before
// the page can observe them — the delay restores the latency every real
// model has (stigmer/stigmer#743). The error levers the conformance proxy
// carries are still intentionally omitted.
interface QueuedResponse {
  body: AnthropicMessageBody;
  delayMs?: number;
}

// A canned Anthropic text turn that ends the agent loop (stop_reason end_turn).
// The model name maps to the Anthropic provider path; token counts are cosmetic.
export function anthropicText(text: string): AnthropicMessageBody {
  return {
    id: "msg_mock_text",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

// One tool_use block in a (possibly multi-call) turn.
export interface ToolUseBlock {
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

// A canned Anthropic turn with one or more tool_use blocks (stop_reason
// tool_use). Multiple blocks model parallel tool calls in a single assistant
// turn, so they are dispatched together and — when each is approval-gated —
// become co-pending approvals at once (the lever for the APPROVE_ALL contract).
export function anthropicToolUses(blocks: ToolUseBlock[]): AnthropicMessageBody {
  return {
    id: "msg_mock_tooluse",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content: blocks.map((b) => ({
      type: "tool_use" as const,
      id: b.toolCallId,
      name: b.toolName,
      input: b.toolInput,
    })),
    stop_reason: "tool_use",
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

export class MockLlmProxy {
  private server: Server | undefined;
  // FIFO of pending turns; a request claims the head synchronously on arrival.
  private readonly queue: QueuedResponse[] = [];

  // Binds to an ephemeral loopback port; resolves once listening.
  async start(): Promise<void> {
    const server = createServer((req, res) => {
      this.handle(req, res).catch(() => {
        // A handler failure (e.g. write after the client vanished) must never
        // crash the server that other tests still depend on.
        if (!res.writableEnded) res.destroy();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    this.server = server;
  }

  // Base URL handed to the runner as STIGMER_PROXY_ENDPOINT AND used by the test
  // worker for the /__mock/* control routes. The Anthropic SDK appends
  // `/v1/proxy/llm/anthropic` + `/v1/messages`, which the handler matches.
  url(): string {
    if (this.server === undefined) {
      throw new Error("MockLlmProxy.start() must be called before url()");
    }
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  // Append a turn to serve. Returns `this` for fluent multi-turn setup.
  enqueue(body: AnthropicMessageBody, delayMs = 0): this {
    this.queue.push({ body, delayMs });
    return this;
  }

  // Drop any unconsumed turns. Call between tests so leftovers can't leak.
  reset(): void {
    this.queue.length = 0;
  }

  // Turns still waiting to be served. `0` after a run means the agent loop
  // consumed exactly its script.
  remaining(): number {
    return this.queue.length;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server === undefined) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = req.url ?? "";

    // Control API (worker -> proxy, cross-process programming). Checked first so
    // the LLM matcher below never claims a control path.
    if (path.startsWith("/__mock/")) {
      await this.handleControl(req, res, path);
      return;
    }

    const isLlm = path.includes("/v1/messages") || path.includes("/v1/proxy/llm/");
    if (!isLlm) {
      writeJson(res, 404, { error: `MockLlmProxy: unhandled path ${path}` });
      return;
    }

    const streaming = await isStreamingRequest(req);

    // The FIFO scripts CONVERSATION turns. In this stack the model registry
    // is empty, so every agent turn resolves to the Anthropic-format
    // fallback model and arrives on an anthropic path (streaming for live
    // console sessions, non-streaming for API-seeded approval executions).
    // The ONLY OpenAI-path caller is GenerateSessionSubject's economy-tier
    // fallback — the session-title call that fires concurrently with a
    // console session's first agent turn. It gets a fixed completion
    // instead of a FIFO turn: letting it claim one would make a test's
    // script race its own session's title call (stigmer/stigmer#743). If a
    // future runner change moves conversation turns onto an OpenAI path,
    // the served=aux diag lines below make that visible immediately.
    if (path.includes("/llm/openai/")) {
      try {
        appendMockLog(
          `${new Date().toISOString()} LLM path=${path} streaming=${streaming} served=aux remaining=${this.queue.length}\n`,
        );
      } catch {
        /* never let diag logging break the proxy */
      }
      writeJson(res, 200, auxiliaryCompletion(path));
      return;
    }

    // Claim the head turn synchronously so concurrent or retried calls can't race
    // for the same entry; an empty queue is a test-authoring error (500).
    const next = this.queue.shift();
    // DIAG-HITL (temporary): record every LLM call the runner makes (esp. the
    // post-approval resume turn) for the resume-wedge probe.
    try {
      const stop = next?.body.stop_reason ?? "EMPTY-500";
      appendMockLog(
        `${new Date().toISOString()} LLM path=${path} streaming=${streaming} served=${stop} remaining=${this.queue.length}\n`,
      );
    } catch {
      /* never let diag logging break the proxy */
    }
    if (next === undefined) {
      writeJson(res, 500, { error: "MockLlmProxy: no queued response" });
      return;
    }

    // Simulated model latency, applied AFTER the synchronous claim so
    // concurrent requests still consume distinct turns in enqueue order.
    if (next.delayMs && next.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, next.delayMs));
    }

    if (streaming) {
      writeAnthropicSse(res, next.body);
    } else {
      writeJson(res, 200, next.body);
    }
  }

  private async handleControl(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
  ): Promise<void> {
    if (req.method === "POST" && path === "/__mock/enqueue") {
      const raw = await readBody(req);
      // Either a bare AnthropicMessageBody (the original wire shape, still
      // sent by the approval helpers) or a { body, delayMs } envelope.
      const parsed = JSON.parse(raw) as
        | AnthropicMessageBody
        | { body: AnthropicMessageBody; delayMs?: number };
      if ("body" in parsed) {
        this.enqueue(parsed.body, parsed.delayMs ?? 0);
      } else {
        this.enqueue(parsed);
      }
      writeJson(res, 200, { ok: true, remaining: this.remaining() });
      return;
    }
    if (req.method === "POST" && path === "/__mock/reset") {
      this.reset();
      writeJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && path === "/__mock/remaining") {
      writeJson(res, 200, { remaining: this.remaining() });
      return;
    }
    writeJson(res, 404, { error: `MockLlmProxy: unknown control path ${path}` });
  }
}

// Resolves true if the request body opts into streaming (the LangChain SDK
// default). Non-streaming callers get a plain JSON body instead of SSE.
/**
 * Fixed completion for auxiliary (non-streaming) calls, shaped for the
 * provider the request path names so the caller's response parsing takes its
 * happy path. Deliberately constant: no spec asserts on auxiliary output
 * (session titles fall back to a heuristic even on failure), and a constant
 * keeps the FIFO's meaning exact — one entry per scripted conversation turn.
 */
function auxiliaryCompletion(path: string): object {
  if (path.includes("/llm/openai/")) {
    return {
      id: "chatcmpl-mock-aux",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "mock-aux",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Mock session" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    };
  }
  return anthropicText("Mock session");
}

async function isStreamingRequest(req: IncomingMessage): Promise<boolean> {
  const raw = await readBody(req);
  if (raw.length === 0) return false;
  try {
    const parsed = JSON.parse(raw) as { stream?: unknown };
    return parsed.stream === true;
  } catch {
    return false;
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// Expands an Anthropic message body into the SSE event sequence the
// @langchain/anthropic streaming parser expects, flushing each event. Mirrors
// the conformance encoder (test/conformance/src/harness/mock-llm.ts).
function writeAnthropicSse(res: ServerResponse, body: AnthropicMessageBody): void {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });

  const event = (name: string, data: unknown): void => {
    res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  event("message_start", {
    type: "message_start",
    message: {
      id: body.id,
      type: "message",
      role: "assistant",
      content: [],
      model: body.model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: body.usage.input_tokens, output_tokens: 0 },
    },
  });

  body.content.forEach((block, index) => {
    switch (block.type) {
      case "text":
        event("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
        event("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
        event("content_block_stop", { type: "content_block_stop", index });
        break;
      case "thinking":
        event("content_block_start", { type: "content_block_start", index, content_block: { type: "thinking", thinking: "" } });
        event("content_block_delta", { type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: block.thinking } });
        event("content_block_stop", { type: "content_block_stop", index });
        break;
      case "tool_use":
        event("content_block_start", {
          type: "content_block_start",
          index,
          content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
        });
        event("content_block_delta", {
          type: "content_block_delta",
          index,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
        });
        event("content_block_stop", { type: "content_block_stop", index });
        break;
    }
  });

  event("message_delta", {
    type: "message_delta",
    delta: { stop_reason: body.stop_reason, stop_sequence: null },
    usage: { output_tokens: body.usage.output_tokens },
  });
  event("message_stop", { type: "message_stop" });
  res.end();
}

// ---------------------------------------------------------------------------
// Process singleton — shared by global-setup and global-teardown
// ---------------------------------------------------------------------------
//
// Playwright runs globalSetup and globalTeardown in the SAME (main) process, so
// a module-level singleton survives between them. global-setup starts the proxy
// (handing its URL to the runner); global-teardown closes it. Both import from
// this one module, keeping the lifecycle in a single place.

let singleton: MockLlmProxy | undefined;

/** Starts the singleton proxy (idempotent within a run) and returns it. */
export async function startMockLlmProxy(): Promise<MockLlmProxy> {
  if (singleton === undefined) {
    singleton = new MockLlmProxy();
    await singleton.start();
  }
  return singleton;
}

/** Closes and clears the singleton proxy, if one was started. No-op otherwise. */
export async function stopMockLlmProxy(): Promise<void> {
  const proxy = singleton;
  singleton = undefined;
  await proxy?.close();
}
