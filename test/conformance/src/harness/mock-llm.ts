// A long-lived, programmable mock LLM proxy for the execution suites.
// Domain: conformance harness (execution engine).
//
// An AgentExecution runs a real LLM loop in the runner, so unlike the data-only
// WorkflowExecution fixtures it cannot be driven offline by jq alone. This mock
// stands in for the upstream provider: the runner is pointed at it via
// STIGMER_PROXY_ENDPOINT (a base-URL override, NOT a "mock" model name), and it
// replays canned Anthropic responses as Server-Sent Events that the runner's
// @langchain/anthropic streaming parser accepts. No API keys, no network.
//
// Why long-lived + programmable (vs. the Go integration mock, which is built
// per-test): the conformance runner boots ONCE per test file with a fixed proxy
// URL, so the response source must be mutable at runtime. Each test enqueues the
// turns it expects and resets in afterEach; Class B runs files serially
// (fileParallelism:false) and tests within a file run serially, so the queue is
// consumed deterministically.
//
// The `delayMs` knob holds a response open, keeping an execution IN_PROGRESS for
// a controllable window — the AgentExecution analogue of the WorkflowExecution
// `wait` timer, and the lever for cancel/terminate/pause/resume on a genuinely
// running execution. A held response must tolerate the client aborting the call
// (cancel/terminate close the socket mid-delay), so the handler no-ops cleanly
// once the connection is gone rather than throwing.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import type { AddressInfo } from "node:net";

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

// One queued turn: the body to serve plus an optional hold before serving it.
interface QueuedResponse {
  body: AnthropicMessageBody;
  delayMs?: number;
}

export interface EnqueueOptions {
  // Hold the response open for this long before streaming it. Used to keep an
  // execution IN_PROGRESS; the hold aborts early if the client disconnects.
  delayMs?: number;
}

// A canned Anthropic text turn that ends the agent loop (stop_reason end_turn).
// The model name maps to the Anthropic provider path; token counts are cosmetic.
export function anthropicText(
  text: string,
  usage: { inputTokens?: number; outputTokens?: number } = {},
): AnthropicMessageBody {
  return {
    id: `msg_mock_${usage.inputTokens ?? 10}`,
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: usage.inputTokens ?? 10, output_tokens: usage.outputTokens ?? 5 },
  };
}

// A canned Anthropic tool_use turn (stop_reason tool_use). The agent will dispatch
// the named tool; queue a following text turn for the post-tool response. Lands
// now to keep the deferred HITL/tool slices cheap to add later.
export function anthropicToolUse(
  toolCallId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  usage: { inputTokens?: number; outputTokens?: number } = {},
): AnthropicMessageBody {
  return anthropicToolUses([{ toolCallId, toolName, toolInput }], usage);
}

// One tool_use block in a multi-call turn.
export interface ToolUseBlock {
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

// A canned Anthropic turn with one or more tool_use blocks (stop_reason
// tool_use). Multiple blocks model parallel tool calls in a single assistant
// turn, so they are dispatched together and — when each is approval-gated —
// become co-pending approvals at once. That is the lever for the APPROVE_ALL
// contract (resolve every co-pending gate with a single decision).
export function anthropicToolUses(
  blocks: ToolUseBlock[],
  usage: { inputTokens?: number; outputTokens?: number } = {},
): AnthropicMessageBody {
  return {
    id: `msg_mock_${usage.inputTokens ?? 10}`,
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
    usage: { input_tokens: usage.inputTokens ?? 10, output_tokens: usage.outputTokens ?? 5 },
  };
}

export class MockLlmProxy {
  private server: Server | undefined;
  // FIFO of pending turns; a request claims the head synchronously on arrival.
  private readonly queue: QueuedResponse[] = [];
  private consumedCount = 0;

  // Binds to an ephemeral loopback port; resolves once listening.
  async start(): Promise<void> {
    const server = createServer((req, res) => {
      this.handle(req, res).catch(() => {
        // A handler failure (e.g. write after the client vanished) must never
        // crash the server that other tests in the file still depend on.
        if (!res.writableEnded) {
          res.destroy();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    this.server = server;
  }

  // Base URL to hand to the runner as STIGMER_PROXY_ENDPOINT. The Anthropic SDK
  // appends `/v1/proxy/llm/anthropic` + `/v1/messages`, which this server matches.
  url(): string {
    if (this.server === undefined) {
      throw new Error("MockLlmProxy.start() must be called before url()");
    }
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  // Append a turn to serve. Returns `this` for fluent multi-turn setup.
  enqueue(body: AnthropicMessageBody, opts: EnqueueOptions = {}): this {
    this.queue.push({ body, delayMs: opts.delayMs });
    return this;
  }

  // Drop any unconsumed turns and zero the consumed counter. Call in afterEach so
  // a prior test's leftovers can't leak into the next one.
  reset(): void {
    this.queue.length = 0;
    this.consumedCount = 0;
  }

  // Turns still waiting to be served. `0` after a run means every queued turn was
  // claimed — the contract assertion that the agent loop consumed exactly its script.
  remaining(): number {
    return this.queue.length;
  }

  // Turns claimed by a request so far (served or aborted mid-hold).
  consumed(): number {
    return this.consumedCount;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server === undefined) {
      return;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = req.url ?? "";
    const isLlm = path.includes("/v1/messages") || path.includes("/v1/proxy/llm/");
    if (!isLlm) {
      writeJson(res, 404, { error: `MockLlmProxy: unhandled path ${path}` });
      return;
    }

    const streaming = await isStreamingRequest(req);

    // Claim the head turn synchronously so concurrent or retried calls can't race
    // for the same entry; an empty queue is a test-authoring error, surfaced as 500.
    const next = this.queue.shift();
    if (next === undefined) {
      writeJson(res, 500, { error: `MockLlmProxy: no queued response (consumed ${this.consumedCount})` });
      return;
    }
    this.consumedCount += 1;

    if (next.delayMs !== undefined && next.delayMs > 0) {
      const aborted = await holdUnlessAborted(req, next.delayMs);
      if (aborted) {
        // Client cancelled/terminated mid-hold: the socket is gone, so there is
        // nothing to write. The turn stays counted as consumed.
        return;
      }
    }

    if (streaming) {
      writeAnthropicSse(res, next.body);
    } else {
      writeJson(res, 200, next.body);
    }
  }
}

// Resolves true if the request body opts into streaming (the LangChain SDK
// default). Non-streaming callers get a plain JSON body instead of SSE.
async function isStreamingRequest(req: IncomingMessage): Promise<boolean> {
  const raw = await readBody(req);
  if (raw.length === 0) {
    return false;
  }
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

// Waits `ms`, or resolves early if the client disconnects first. Returns true
// when the wait was cut short by a disconnect (the response can no longer be sent).
async function holdUnlessAborted(req: IncomingMessage, ms: number): Promise<boolean> {
  const controller = new AbortController();
  let aborted = false;
  const onClose = (): void => {
    aborted = true;
    controller.abort();
  };
  req.once("close", onClose);
  try {
    await delay(ms, undefined, { signal: controller.signal });
  } catch {
    // delay rejects with an AbortError when the socket closes — expected.
  } finally {
    req.removeListener("close", onClose);
  }
  return aborted;
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// Expands an Anthropic message body into the SSE event sequence the
// @langchain/anthropic streaming parser expects, flushing each event. Mirrors
// the Go reference encoder in test/integration/harness/mock_llm_proxy.go.
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
