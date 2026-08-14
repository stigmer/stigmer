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
// The queue scripts THE AGENT LOOP UNDER TEST — and only it. The runner also
// makes background LLM calls that are production behavior, not part of any
// test's script: session-subject titling (#690) fires per execution as a
// Temporal fire-and-forget racing the agent turn, and letting it claim queued
// turns broke every agent suite at once (approval gates sailed to COMPLETED on
// the eaten tool_use turn, forced failures completed, smoke turns starved —
// stigmer/stigmer#715). Two defenses, in order:
//   1. Provider fence — this mock speaks ONLY Anthropic; a request on any
//      other provider's proxy path is answered with a loud 500 instead of a
//      queued turn (#715's thief was the titling call leaving on the OpenAI
//      path via the runner's baked gpt-4.1 primaryModel default, eating
//      Anthropic turns it couldn't even parse; the harness now pins
//      STIGMER_PRIMARY_MODEL, and this fence makes any regression legible).
//   2. Signature routing — recognized background calls (the titling system
//      prompt) are answered out-of-band with a canned body, never from the
//      queue. A NEW background call class surfaces as a hard 500 ("no queued
//      response") — extend the signature match here, never the test queues.
// Out-of-band and fenced requests still appear in requests(): that surface's
// contract is "everything the model received over the wire".
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

// One queued turn: either a success body to stream, or an HTTP error status to
// fail the call with, plus an optional hold before responding. `errorStatus` and
// `body` are mutually exclusive — exactly one is set per entry.
interface QueuedResponse {
  body?: AnthropicMessageBody;
  errorStatus?: number;
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

// One LLM call as the provider would have received it: the request path and
// the parsed JSON body (the Anthropic `messages` payload). Captured so a test
// can assert on what the runner actually SENT — e.g. that an image attachment
// arrived as a base64 image block — not just on what came back.
export interface CapturedLlmRequest {
  path: string;
  body: unknown;
}

// The stable slice of the session-titling system prompt (SYSTEM_PROMPT in
// backend/services/runner/src/activities/generate-session-subject.ts, kept in
// lockstep with the cloud activity). Deliberately a short, meaning-bearing
// substring so prompt wording can evolve around it without breaking the match.
const TITLE_GENERATION_SIGNATURE = "session title generator";

// The canned title every out-of-band titling call receives. Exported so a
// suite can pin the full loop: mock answers → activity cleans and caps the
// text → session subject updates. Must satisfy the activity's post-processing
// (≤50 chars, no trailing punctuation) to arrive verbatim.
export const MOCK_SESSION_TITLE = "Conformance Agent Session";

// True when an Anthropic messages payload is the runner's background
// session-titling call rather than an agent-loop turn. LangChain sends the
// system prompt as `system`, either a plain string or an array of text blocks
// depending on client version — both shapes are folded to text before matching.
function isTitleGenerationRequest(body: unknown): boolean {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const system = (body as { system?: unknown }).system;
  let text: string;
  if (typeof system === "string") {
    text = system;
  } else if (Array.isArray(system)) {
    text = system
      .map((block) => (typeof block === "object" && block !== null ? String((block as { text?: unknown }).text ?? "") : ""))
      .join(" ");
  } else {
    return false;
  }
  return text.toLowerCase().includes(TITLE_GENERATION_SIGNATURE);
}

export class MockLlmProxy {
  private server: Server | undefined;
  // FIFO of pending turns; a request claims the head synchronously on arrival.
  private readonly queue: QueuedResponse[] = [];
  private consumedCount = 0;
  // Every LLM request body this proxy has received, in arrival order. Cleared
  // by reset() at the afterEach boundary like the queue.
  private readonly captured: CapturedLlmRequest[] = [];
  // Background titling calls answered out-of-band (#690/#715) — an observation
  // point, deliberately NOT part of consumed()/remaining() queue accounting.
  private titleRequestCount = 0;
  // In-flight held responses, keyed by an abort callback. releaseHolds() invokes
  // each to unblock a delayed response early (independent of a socket close).
  private readonly activeHolds = new Set<() => void>();
  // When true, subsequent held turns skip their delay and respond immediately.
  // Set by releaseHolds() so a runner turn that only reaches the proxy AFTER the
  // test has quiesced the mock (e.g. a resume re-invocation that was blocked on
  // the session workspace lock) finishes at once instead of holding the full
  // window. Cleared by reset() at the afterEach boundary.
  private draining = false;

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

  // Append a turn that responds with an HTTP error status instead of a body — the
  // lever for driving an execution to EXECUTION_FAILED deterministically. Lands now
  // to keep the deferred AgentExecution-recover end-to-end slice cheap to add later
  // (that slice is blocked on the recovery-mechanism redesign, see DD-013).
  //
  // Status choice matters: the runner's agent loop wraps the LLM call in
  // LangChain's AsyncCaller, which retries 6x with exponential backoff for 429 and
  // 5xx but throws IMMEDIATELY for statuses in its STATUS_NO_RETRY list
  // (400/401/402/403/404/405/406/407/409). For a fail-fast, single-round-trip
  // failure use a non-retryable status (default 400); a 5xx would instead stall
  // the execution in IN_PROGRESS for ~a minute before failing. The deep-agent
  // activity runs with MaximumAttempts:1, so the first thrown error becomes a
  // terminal EXECUTION_FAILED with no Temporal retry.
  enqueueError(status = 400, opts: EnqueueOptions = {}): this {
    this.queue.push({ errorStatus: status, delayMs: opts.delayMs });
    return this;
  }

  // Unblock every in-flight held response immediately and put the mock into
  // drain mode so any subsequent held turn responds at once. This is the lever a
  // lifecycle test pulls to quiesce the runner before the test ends: a paused or
  // cancelled agent turn is NOT preempted mid-LLM-call by the runner (it only
  // checks for cancellation between coarse graph events, of which a single held
  // turn produces none until it resolves), so without this the held turn — and
  // any resume re-invocation queued behind the session workspace lock — would
  // keep an activity alive for the full hold window and leak into the next test.
  releaseHolds(): void {
    this.draining = true;
    for (const abort of [...this.activeHolds]) {
      abort();
    }
    this.activeHolds.clear();
  }

  // Drop any unconsumed turns, zero the consumed counter, clear captured
  // requests, and re-arm holds. Call in afterEach so a prior test's leftovers
  // can't leak into the next one.
  reset(): void {
    this.queue.length = 0;
    this.consumedCount = 0;
    this.captured.length = 0;
    this.titleRequestCount = 0;
    this.releaseHolds();
    this.draining = false;
  }

  // The provider-bound request bodies received so far (arrival order). This is
  // the only observation point in the repo for "what did the model actually
  // receive over the wire" — live provider calls are out of conformance scope.
  requests(): readonly CapturedLlmRequest[] {
    return this.captured;
  }

  // Holds the response for `ms`, resolving early (returning true) if the client
  // disconnects or releaseHolds() fires. In drain mode the hold is skipped
  // entirely so the response is sent immediately.
  private async hold(req: IncomingMessage, ms: number): Promise<boolean> {
    if (this.draining) {
      return false;
    }
    const controller = new AbortController();
    let aborted = false;
    const onClose = (): void => {
      aborted = true;
      controller.abort();
    };
    const release = (): void => {
      // releaseHolds unblocks the wait but lets the response be written (unlike a
      // client disconnect, where the socket is gone).
      controller.abort();
    };
    req.once("close", onClose);
    this.activeHolds.add(release);
    try {
      await delay(ms, undefined, { signal: controller.signal });
    } catch {
      // delay rejects with an AbortError on disconnect or release — expected.
    } finally {
      req.removeListener("close", onClose);
      this.activeHolds.delete(release);
    }
    return aborted;
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

  // Background titling calls served out-of-band so far.
  titleRequests(): number {
    return this.titleRequestCount;
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

    // Read the body once: it is both the streaming discriminator and the
    // captured request a test can assert on.
    const raw = await readBody(req);
    let parsedBody: unknown;
    try {
      parsedBody = raw.length > 0 ? JSON.parse(raw) : undefined;
    } catch {
      parsedBody = raw;
    }
    this.captured.push({ path, body: parsedBody });
    const streaming =
      typeof parsedBody === "object" &&
      parsedBody !== null &&
      (parsedBody as { stream?: unknown }).stream === true;

    // Provider fence: queued turns are Anthropic-shaped SSE/JSON, so serving
    // one to another provider's client corrupts BOTH the caller (unparseable
    // body) and the test (stolen turn). Fail loudly instead — the message
    // names the fix so a future non-Anthropic caller is a five-minute triage,
    // not a phase-timeout mystery (#715).
    const isForeignProvider = path.includes("/v1/proxy/llm/") && !path.includes("/v1/proxy/llm/anthropic");
    if (isForeignProvider) {
      writeJson(res, 500, {
        error:
          `MockLlmProxy speaks only Anthropic but received ${path}. A runner-side LLM caller ` +
          `is routing to another provider — pin its model to an Anthropic one in the harness ` +
          `env (see STIGMER_PRIMARY_MODEL in runner-process.ts) or teach this mock the provider.`,
      });
      return;
    }

    // Background calls are answered out-of-band, NEVER from the queue: the
    // queue is the agent loop's script, and a background call claiming a turn
    // starves or derails the loop under test (#715). The canned title is
    // wired all the way through — the titling activity really parses it and
    // writes it as the session subject, so suites can pin the feature.
    if (isTitleGenerationRequest(parsedBody)) {
      this.titleRequestCount += 1;
      const body = anthropicText(MOCK_SESSION_TITLE);
      if (streaming) {
        writeAnthropicSse(res, body);
      } else {
        writeJson(res, 200, body);
      }
      return;
    }

    // Claim the head turn synchronously so concurrent or retried calls can't race
    // for the same entry; an empty queue is a test-authoring error, surfaced as 500.
    const next = this.queue.shift();
    if (next === undefined) {
      writeJson(res, 500, { error: `MockLlmProxy: no queued response (consumed ${this.consumedCount})` });
      return;
    }
    this.consumedCount += 1;

    if (next.delayMs !== undefined && next.delayMs > 0) {
      const aborted = await this.hold(req, next.delayMs);
      if (aborted) {
        // Client disconnected, or releaseHolds() was called to quiesce the mock:
        // the response is abandoned. The turn stays counted as consumed.
        return;
      }
    }

    // An injected error turn fails the call with the requested status. The body
    // mirrors Anthropic's error envelope so the SDK surfaces a real HTTP error.
    if (next.errorStatus !== undefined) {
      writeJson(res, next.errorStatus, {
        type: "error",
        error: { type: "invalid_request_error", message: "MockLlmProxy: injected failure" },
      });
      return;
    }

    if (next.body === undefined) {
      // Defensive: every non-error turn is enqueued with a body via enqueue().
      writeJson(res, 500, { error: "MockLlmProxy: queued turn had neither body nor errorStatus" });
      return;
    }

    if (streaming) {
      writeAnthropicSse(res, next.body);
    } else {
      writeJson(res, 200, next.body);
    }
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
