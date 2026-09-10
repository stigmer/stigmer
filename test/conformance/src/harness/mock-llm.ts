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
//
// One OPT-IN carve-out from the provider fence: embeddings (entry
// 20260910.02, the memory-selection arms). The runner's memory retriever
// posts one batched call to the OpenAI embeddings path when it has more
// candidates than its threshold (shared/memory-retrieval.ts). The fence
// refusing that call IS the no-embedder posture the memory-retrieval suite
// pins, so it stays the default; a file that wants the embedder posture calls
// serveEmbeddings(true) once in beforeAll and the mock then answers the path
// by COMPUTATION, never from the queue — input i embeds to a unit vector at
// angle (i / n) · π/2, so cosine similarity to input 0 (the query) strictly
// decreases with position and top-k is exactly the first k candidates in
// snapshot order, the assertion the arms make against injected_memory_ids.
// Embeddings requests are captured on their own surface (embeddingsRequests),
// not in the chat queue's accounting.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { anthropicText, writeAnthropicSse, writeJson, type AnthropicMessageBody } from "./llm-wire";
import { setTimeout as delay } from "node:timers/promises";
import type { AddressInfo } from "node:net";

// The provider wire shapes (bodies, builders, the SSE encoder) live in
// llm-wire.ts, shared with FakeLlmUpstream — the proxy is transparent, so the
// two fakes must emit the same bytes. Re-exported here so the execution suites
// keep importing them from the mock they script.
export {
  anthropicText,
  anthropicToolUse,
  anthropicToolUses,
  type AnthropicContentBlock,
  type AnthropicMessageBody,
  type ToolUseBlock,
} from "./llm-wire";

// One queued turn: either a success body to stream, or an HTTP error to fail
// the call with, plus an optional hold before responding. `error` and `body`
// are mutually exclusive — exactly one is set per entry.
interface QueuedResponse {
  body?: AnthropicMessageBody;
  error?: QueuedError;
  delayMs?: number;
}

// An injected provider failure as the real proxy relays one: a status, the
// provider's JSON error body, and any headers the proxy forwards. Errors are
// written as status + JSON regardless of the request's `stream` flag — exactly
// what the real proxy does (a provider error never arrives as SSE).
interface QueuedError {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  persistent: boolean;
}

export interface EnqueueOptions {
  // Hold the response open for this long before streaming it. Used to keep an
  // execution IN_PROGRESS; the hold aborts early if the client disconnects.
  delayMs?: number;
}

export interface EnqueueErrorOptions extends EnqueueOptions {
  // Response headers the proxy would forward from the provider (e.g. Anthropic's
  // `x-should-retry: false`, the SDK-level no-retry hint).
  headers?: Record<string, string>;
  // The provider's error body verbatim. Defaults to a generic Anthropic
  // invalid_request_error envelope so a fail-fast arm needs no body of its own.
  body?: unknown;
  // Keep answering this error to every later request, until reset(). A real
  // provider or platform fault PERSISTS across a caller's retries; without this
  // the retries would drain the queue and the run would fail on the mock's own
  // "no queued response" 500 instead of the fault under test. Set it for any
  // status LangChain's AsyncCaller retries (5xx, 429).
  persistent?: boolean;
}

// The body an error turn carries when the arm supplies none: Anthropic's
// envelope, so the SDK surfaces a real HTTP error.
export const DEFAULT_ERROR_BODY = {
  type: "error",
  error: { type: "invalid_request_error", message: "MockLlmProxy: injected failure" },
} as const;

export interface CapturedLlmRequest {
  path: string;
  body: unknown;
}

// One embeddings request as the retriever sent it: the model it asked for and
// the batched inputs (the query first, then every candidate in snapshot order).
export interface CapturedEmbeddingsRequest {
  path: string;
  model: string;
  input: string[];
}

// The embeddings response shape the runner's retriever parses (OpenAI's:
// `data[i].embedding` in input order, usage carrying prompt tokens only).
// Exported so the unit arm and the mock share one definition of the wire.
export interface EmbeddingsResponseBody {
  object: "list";
  model: string;
  data: Array<{ object: "embedding"; index: number; embedding: number[] }>;
  usage: { prompt_tokens: number; total_tokens: number };
}

// Deterministic vectors for a batch of `count` inputs: input 0 at angle 0
// ([1, 0]), later inputs at angle (i / count) · π/2, so cosine similarity to
// input 0 strictly decreases with position. Pure; the unit arm pins the
// ordering property the memory-selection arms rely on.
export function deterministicEmbeddings(count: number): number[][] {
  return Array.from({ length: count }, (_, i) => {
    const angle = count > 1 ? (i / count) * (Math.PI / 2) : 0;
    return [Math.cos(angle), Math.sin(angle)];
  });
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
  // Whether the embeddings path is answered (by computation) or fenced (the
  // default, the no-embedder posture). A per-file posture, so reset() leaves it.
  private embeddingsServed = false;
  // Every embeddings request answered so far, arrival order; cleared by reset().
  private readonly embeddingsCaptured: CapturedEmbeddingsRequest[] = [];
  // In-flight held responses, keyed by an abort callback. releaseHolds() invokes
  // each to unblock a delayed response early (independent of a socket close).
  private readonly activeHolds = new Set<() => void>();
  // A persistent error turn once served: every request that finds the queue
  // empty is answered with it (see EnqueueErrorOptions.persistent). Cleared by
  // reset().
  private persistentError: QueuedError | undefined;
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

  // Append a turn that responds with an HTTP error instead of a body — the
  // lever for driving an execution to EXECUTION_FAILED deterministically. Lands now
  // to keep the deferred AgentExecution-recover end-to-end slice cheap to add later
  // (that slice is blocked on the recovery-mechanism redesign, see DD-013).
  //
  // Status choice matters: the runner's agent loop wraps the LLM call in
  // LangChain's AsyncCaller, which retries 6x with exponential backoff for 429 and
  // 5xx but throws IMMEDIATELY for statuses in its STATUS_NO_RETRY list
  // (400/401/402/403/404/405/406/407/409). For a fail-fast, single-round-trip
  // failure use a non-retryable status (default 400); a 5xx instead stalls the
  // execution in IN_PROGRESS for over a minute of AsyncCaller backoff before
  // failing — the proxy's `x-should-retry: false` header stops the provider
  // SDK's own retries, not LangChain's — so an arm that scripts a 5xx (the
  // platform-capacity 503 the attribution suite carries) budgets for it. The
  // deep-agent activity runs with MaximumAttempts:1, so the first thrown error
  // becomes a terminal EXECUTION_FAILED with no Temporal retry.
  //
  // `headers` and `body` let an arm script the provider's failure byte-exact —
  // the raw Anthropic billing envelope, the platform's capacity rewrite — so the
  // runner's attribution of WHO failed is asserted on the real shapes.
  enqueueError(status = 400, opts: EnqueueErrorOptions = {}): this {
    this.queue.push({
      error: {
        status,
        headers: opts.headers ?? {},
        body: opts.body ?? DEFAULT_ERROR_BODY,
        persistent: opts.persistent ?? false,
      },
      delayMs: opts.delayMs,
    });
    return this;
  }

  // Flip the embeddings posture for this file (see header). Off by default —
  // the no-embedder posture the memory-retrieval suite pins; on for the
  // memory-selection arms. Not touched by reset(): a posture, not per-test state.
  serveEmbeddings(enabled: boolean): void {
    this.embeddingsServed = enabled;
  }

  // Embeddings requests answered so far (arrival order). The memory-selection
  // arms assert the COUNT (exactly one batched call above the threshold, none
  // at or below it) and the batch shape (query first, then every candidate).
  embeddingsRequests(): readonly CapturedEmbeddingsRequest[] {
    return this.embeddingsCaptured;
  }

  // The `model` field of every captured chat request, in order — the id the
  // PROVIDER received, after the runner's registry resolution. The assertion
  // target for the model-resolution arms: a registry id that reaches the wire
  // unresolved is the regression they exist to catch.
  requestModels(): string[] {
    return this.captured.flatMap((request) => {
      const model = (request.body as { model?: unknown } | undefined)?.model;
      return typeof model === "string" ? [model] : [];
    });
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
    this.embeddingsCaptured.length = 0;
    this.titleRequestCount = 0;
    this.persistentError = undefined;
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

    // Embeddings, when served, are answered by computation BEFORE the fence
    // and outside the queue: an embeddings call must never claim a scripted
    // chat turn (header). When not served the request falls through to the
    // fence below and is refused like any other OpenAI-path call — the
    // no-embedder posture, unchanged.
    if (this.embeddingsServed && path.includes("/embeddings")) {
      this.handleEmbeddings(path, parsedBody, res);
      return;
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
    // for the same entry. An empty queue is a test-authoring error, surfaced as
    // 500 — unless a persistent error turn was served, in which case the fault
    // it models is what every retry keeps hitting.
    const next = this.queue.shift();
    if (next === undefined) {
      if (this.persistentError !== undefined) {
        writeJson(res, this.persistentError.status, this.persistentError.body, this.persistentError.headers);
        return;
      }
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

    // An injected error turn fails the call with the scripted status, headers
    // and body — as JSON whatever the request's stream flag, the way the real
    // proxy relays a provider error.
    if (next.error !== undefined) {
      if (next.error.persistent) this.persistentError = next.error;
      writeJson(res, next.error.status, next.error.body, next.error.headers);
      return;
    }

    if (next.body === undefined) {
      // Defensive: every non-error turn is enqueued with a body via enqueue().
      writeJson(res, 500, { error: "MockLlmProxy: queued turn had neither body nor error" });
      return;
    }

    if (streaming) {
      writeAnthropicSse(res, next.body);
    } else {
      writeJson(res, 200, next.body);
    }
  }

  // Answers one batched embeddings call by computation (header). The retriever
  // sends `input` as an array of strings (query first); a malformed body is a
  // harness-authoring error and is refused loudly rather than guessed at.
  private handleEmbeddings(path: string, body: unknown, res: ServerResponse): void {
    const request = body as { model?: unknown; input?: unknown } | undefined;
    const input = request?.input;
    if (!Array.isArray(input) || !input.every((item): item is string => typeof item === "string")) {
      writeJson(res, 400, { error: "MockLlmProxy: embeddings `input` must be an array of strings" });
      return;
    }
    const model = typeof request?.model === "string" ? request.model : "";
    this.embeddingsCaptured.push({ path, model, input });

    // The rough chars/4 token estimate keeps metering-shaped consumers honest
    // without a tokenizer (the Go mock's convention).
    const promptTokens = Math.floor(input.reduce((sum, text) => sum + text.length, 0) / 4);
    const response: EmbeddingsResponseBody = {
      object: "list",
      model,
      data: deterministicEmbeddings(input.length).map((embedding, index) => ({
        object: "embedding",
        index,
        embedding,
      })),
      usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
    };
    writeJson(res, 200, response);
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
