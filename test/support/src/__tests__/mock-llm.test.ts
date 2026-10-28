// Unit arms for the mock LLM proxy's wire behavior — the surfaces the
// execution suites script and observe, driven over loopback with no runner.
// Domain: test support (model fakes).
//
// Pinned here: the opt-in embeddings carve-out keeps the
// default (fenced) posture the memory-retrieval suite relies on and, when
// enabled, answers by computation with the ordering property the
// memory-selection arms assert on; an injected error carries the scripted
// status, headers and body as JSON even for a streaming request;
// requestModels() reads the id the provider saw off every captured request;
// and every captured request carries the disposition the answering branch
// decided, so scriptedRequests() is exactly the agent loop's calls; a mock
// bound to another address answers there, and urlAt() names it as the
// runner's side does; native compaction's summary call is recognized by the
// runner's own prompt opening, read from the runner's source; a router
// answers from the request's content before the queue, an error or a token
// count as it says, and falls through to the queue when it answers nothing;
// every captured request keeps the headers it arrived with; a router one test
// installs (routeWith) lasts until reset(), its background answers are
// out of band, and loopRequests() is the loop's calls however answered; a
// held call its caller hangs up is stamped hungUpAt at the hang-up, and one
// releaseHolds() ends is served and never stamped.
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_ERROR_BODY,
  MockLlmProxy,
  anthropicText,
  deterministicEmbeddings,
  type CapturedLlmRequest,
  type EmbeddingsResponseBody,
  MOCK_CONVERSATION_SUMMARY,
  SUMMARY_PROMPT_OPENING,
} from "../mock-llm.ts";

const mock = new MockLlmProxy();

beforeAll(async () => {
  await mock.start();
});

afterEach(() => {
  mock.reset();
  mock.serveEmbeddings(false);
});

afterAll(async () => {
  await mock.close();
});

// The runner's retriever posts to the OpenAI provider path under the proxy
// (shared/memory-retrieval.ts resolveProxyBaseUrl(…, "openai") + /embeddings).
const EMBEDDINGS_PATH = "/v1/proxy/llm/openai/v1/embeddings";
const ANTHROPIC_PATH = "/v1/proxy/llm/anthropic/v1/messages";

function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${mock.url()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function cosine(a: number[], b: number[]): number {
  return a.reduce((sum, value, i) => sum + value * (b[i] ?? 0), 0);
}

describe("MockLlmProxy embeddings posture", () => {
  it("fences the embeddings path by default (the no-embedder posture) and still captures the request", async () => {
    const response = await post(EMBEDDINGS_PATH, { model: "text-embedding-3-small", input: ["q", "a"] });

    expect(response.status, "a non-Anthropic proxy path is refused loudly").toBe(500);
    expect(mock.requests().map((r) => r.path), "the refused call is visible on the chat surface").toEqual([EMBEDDINGS_PATH]);
    expect(mock.embeddingsRequests(), "nothing was served, so nothing is on the embeddings surface").toHaveLength(0);
    expect(mock.consumed(), "a fenced call never claims a queued turn").toBe(0);
  });

  it("when enabled, answers by computation with one unit vector per input whose similarity to the query strictly decreases", async () => {
    mock.serveEmbeddings(true);
    mock.enqueue(anthropicText("a chat turn that must stay queued"));
    const input = ["the query", "fact 0", "fact 1", "fact 2", "fact 3"];

    const response = await post(EMBEDDINGS_PATH, { model: "text-embedding-3-small", input });
    const body = (await response.json()) as EmbeddingsResponseBody;

    expect(response.status).toBe(200);
    expect(body.object).toBe("list");
    expect(body.model).toBe("text-embedding-3-small");
    expect(body.data.map((d) => d.index)).toEqual([0, 1, 2, 3, 4]);
    const query = body.data[0]!.embedding;
    const similarities = body.data.slice(1).map((d) => cosine(query, d.embedding));
    for (let i = 1; i < similarities.length; i++) {
      expect(similarities[i]!, `fact ${i} is farther from the query than fact ${i - 1}`).toBeLessThan(similarities[i - 1]!);
    }
    expect(body.usage.prompt_tokens, "chars/4 keeps metering-shaped consumers honest").toBe(
      Math.floor(input.join("").length / 4),
    );
    expect(mock.embeddingsRequests()).toEqual([{ path: EMBEDDINGS_PATH, model: "text-embedding-3-small", input }]);
    expect(mock.requests(), "served embeddings never appear on the chat surface").toHaveLength(0);
    expect(mock.remaining(), "the chat queue is untouched by an embeddings call").toBe(1);
  });

  it("refuses a malformed embeddings body by name instead of guessing", async () => {
    mock.serveEmbeddings(true);
    const response = await post(EMBEDDINGS_PATH, { model: "m", input: "not-an-array" });
    expect(response.status).toBe(400);
    expect(mock.embeddingsRequests()).toHaveLength(0);
  });

  it("deterministicEmbeddings: a single input is the unit x vector; n inputs span the first quadrant in order", () => {
    expect(deterministicEmbeddings(1)).toEqual([[1, 0]]);
    const three = deterministicEmbeddings(3);
    expect(three[0]).toEqual([1, 0]);
    expect(three.map((v) => Math.hypot(v[0]!, v[1]!)).every((n) => Math.abs(n - 1) < 1e-12), "unit vectors").toBe(true);
    expect(three.map((v) => v[1]!), "angles increase with position").toEqual([...three.map((v) => v[1]!)].sort((a, b) => a - b));
  });
});

describe("MockLlmProxy error turns", () => {
  it("relays a scripted status, headers and body as JSON even when the request streams", async () => {
    const body = { type: "error", error: { type: "api_error", message: "platform capacity [code: X]" } };
    mock.enqueueError(503, { headers: { "x-should-retry": "false" }, body });

    const response = await post(ANTHROPIC_PATH, { model: "claude-sonnet-4-6", stream: true, messages: [] });

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("x-should-retry")).toBe("false");
    expect(await response.json()).toEqual(body);
    expect(mock.consumed()).toBe(1);
  });

  it("a persistent error keeps answering every retry after the queue drains, and reset() clears it", async () => {
    const body = { type: "error", error: { type: "api_error", message: "still down" } };
    mock.enqueueError(503, { body, persistent: true });

    const first = await post(ANTHROPIC_PATH, { model: "claude-sonnet-4-6", messages: [] });
    const retry = await post(ANTHROPIC_PATH, { model: "claude-sonnet-4-6", messages: [] });
    const later = await post(ANTHROPIC_PATH, { model: "claude-sonnet-4-6", messages: [] });

    expect([first.status, retry.status, later.status], "the fault persists across the caller's retries").toEqual([503, 503, 503]);
    expect(await later.json()).toEqual(body);
    expect(mock.consumed(), "only the scripted turn counts as consumed; retries hit the fault, not the queue").toBe(1);

    mock.reset();
    const afterReset = await post(ANTHROPIC_PATH, { model: "claude-sonnet-4-6", messages: [] });
    expect(afterReset.status, "reset() forgets the fault: an empty queue is the authoring error again").toBe(500);
    expect(((await afterReset.json()) as { error: string }).error).toContain("no queued response");
  });

  it("defaults to a 400 with the Anthropic invalid_request envelope when nothing else is scripted", async () => {
    mock.enqueueError();
    const response = await post(ANTHROPIC_PATH, { model: "claude-sonnet-4-6", messages: [] });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(DEFAULT_ERROR_BODY);
  });
});

describe("MockLlmProxy requestModels", () => {
  it("reads the model the provider received off every captured chat request, in order, skipping requests without one", async () => {
    mock.enqueue(anthropicText("one")).enqueue(anthropicText("two")).enqueue(anthropicText("three"));
    await post(ANTHROPIC_PATH, { model: "claude-haiku-4-5-20251001", messages: [] });
    await post(ANTHROPIC_PATH, { messages: [] });
    await post(ANTHROPIC_PATH, { model: "claude-sonnet-4-6", messages: [] });

    expect(mock.requestModels()).toEqual(["claude-haiku-4-5-20251001", "claude-sonnet-4-6"]);
  });
});

describe("MockLlmProxy request disposition", () => {
  // The titling signature the mock recognizes (the stable slice of the runner's
  // session-title system prompt); a body carrying it is answered out of band.
  const TITLING_BODY = { model: "claude-sonnet-4-6", system: "You are a session title generator.", messages: [] };

  it("records how each request was answered, and scriptedRequests() is exactly the queue's claimants", async () => {
    mock.enqueue(anthropicText("the agent's turn"));

    await post(EMBEDDINGS_PATH, { model: "text-embedding-3-small", input: ["q"] });
    await post(ANTHROPIC_PATH, TITLING_BODY);
    await post(ANTHROPIC_PATH, { model: "claude-sonnet-4-6", system: "You are the agent.", messages: [] });
    const starved = await post(ANTHROPIC_PATH, { model: "claude-sonnet-4-6", system: "You are the agent.", messages: [] });

    expect(starved.status, "the queue is empty by the fourth call").toBe(500);
    expect(
      mock.requests().map((r) => r.disposition),
      "one request per disposition, in arrival order",
    ).toEqual(["fenced", "out-of-band", "scripted", "unscripted"]);
    expect(mock.scriptedRequests(), "only the claimant of the queued turn").toHaveLength(1);
    expect((mock.scriptedRequests()[0]!.body as { system: string }).system).toBe("You are the agent.");
    expect(mock.consumed(), "the disposition agrees with the queue accounting").toBe(1);
    expect(mock.titleRequests(), "and with the out-of-band count").toBe(1);
  });

  it("answers native compaction's summary call out of band and counts it; the queue is never touched", async () => {
    mock.enqueue(anthropicText("the agent's turn"));
    const summary = await post(ANTHROPIC_PATH, {
      model: "claude-haiku-4-5-20251001",
      messages: [{ role: "user", content: [{ type: "text", text: `${SUMMARY_PROMPT_OPENING}\n\nThe conversation below is between a user and an agent.` }] }],
    });
    expect(summary.status).toBe(200);
    expect(JSON.stringify(await summary.json())).toContain(MOCK_CONVERSATION_SUMMARY);
    expect(mock.summaryRequests()).toBe(1);
    expect(mock.remaining(), "the agent's turn is still queued").toBe(1);
    expect(mock.requests().map((r) => r.disposition)).toEqual(["out-of-band"]);

    // A turn that merely mentions summarizing, or carries more than the one message, is the agent's.
    await post(ANTHROPIC_PATH, {
      model: "claude-haiku-4-5-20251001",
      messages: [
        { role: "user", content: "Summarize the repository." },
        { role: "assistant", content: SUMMARY_PROMPT_OPENING },
      ],
    });
    expect(mock.summaryRequests()).toBe(1);
    expect(mock.consumed()).toBe(1);
  });

  it("recognizes the summary call by the runner's own prompt opening, the source this copy follows", () => {
    const source = readFileSync(new URL("../../../../backend/services/runner/src/middleware/compaction-prompt.ts", import.meta.url), "utf8");
    expect(/export const SUMMARY_PROMPT_OPENING = "([^"]+)";/.exec(source)?.[1]).toBe(SUMMARY_PROMPT_OPENING);
  });

  it("a request answered by a persistent fault after the queue drained is unscripted, not scripted", async () => {
    mock.enqueueError(503, { persistent: true });

    await post(ANTHROPIC_PATH, { model: "claude-sonnet-4-6", messages: [] });
    await post(ANTHROPIC_PATH, { model: "claude-sonnet-4-6", messages: [] });

    expect(mock.requests().map((r) => r.disposition), "the scripted fault, then the retry that hit it").toEqual([
      "scripted",
      "unscripted",
    ]);
  });
});

describe("MockLlmProxy's router", () => {
  it("answers from the request's content before the queue, and falls through to it when it answers nothing", async () => {
    const routed = new MockLlmProxy({
      route: (request) => {
        const body = request.body as { messages?: { content?: unknown }[] };
        const last = body.messages?.at(-1)?.content;
        if (last === "count") return { json: { input_tokens: 7 } };
        if (last === "refuse") return { error: { status: 529, body: { type: "error", error: { type: "overloaded_error", message: "busy" } } } };
        if (last === "hello") return { body: anthropicText(`routed for ${String(request.headers["x-api-key"])}`) };
        return undefined;
      },
    });
    await routed.start();
    try {
      routed.enqueue(anthropicText("queued"));
      const ask = (content: string, stream = false): Promise<Response> =>
        fetch(`${routed.url()}${ANTHROPIC_PATH}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": "the-key" },
          body: JSON.stringify({ model: "m", stream, messages: [{ role: "user", content }] }),
        });

      const hello = (await (await ask("hello")).json()) as { content: { text: string }[] };
      expect(hello.content[0]?.text, "answered from the content, the headers in view").toBe("routed for the-key");
      expect((await ask("hello", true)).headers.get("content-type"), "streamed when the request streams").toContain("text/event-stream");
      expect(await (await ask("count")).json()).toEqual({ input_tokens: 7 });
      expect((await ask("refuse")).status).toBe(529);
      const fell = (await (await ask("anything else")).json()) as { content: { text: string }[] };
      expect(fell.content[0]?.text, "nothing routed: the queue answers").toBe("queued");

      expect(routed.requests().map((r) => r.disposition)).toEqual(["routed", "routed", "routed", "routed", "scripted"]);
      expect(routed.consumed(), "a routed request claims no queued turn").toBe(1);
      expect(routed.requests().every((r) => r.headers["x-api-key"] === "the-key"), "each capture keeps its headers").toBe(true);
    } finally {
      await routed.close();
    }
  });
});

describe("MockLlmProxy.routeWith", () => {
  const ask = (content: string): Promise<Response> => post(ANTHROPIC_PATH, { model: "m", messages: [{ role: "user", content }] });

  it("installs a router for one test on a mock built without one; reset() removes it, as it clears the queue", async () => {
    mock.routeWith((request) => {
      const last = (request.body as { messages?: { content?: unknown }[] }).messages?.at(-1)?.content;
      if (last === "count") return { json: { input_tokens: 3 }, outOfBand: true };
      return { body: anthropicText(`routed ${String(last)}`) };
    });
    mock.enqueue(anthropicText("queued"));
    const routed = (await (await ask("hello")).json()) as { content: { text: string }[] };
    expect(routed.content[0]?.text).toBe("routed hello");
    expect(await (await ask("count")).json()).toEqual({ input_tokens: 3 });
    expect(mock.requests().map((r) => r.disposition), "a router's background answer is out of band").toEqual(["routed", "out-of-band"]);
    expect(mock.loopRequests().map((r) => r.disposition), "the loop's requests, however answered").toEqual(["routed"]);
    expect(mock.remaining(), "the queue untouched").toBe(1);

    mock.reset();
    mock.enqueue(anthropicText("queued"));
    const queued = (await (await ask("hello")).json()) as { content: { text: string }[] };
    expect(queued.content[0]?.text, "after reset the queue answers").toBe("queued");
    expect(mock.loopRequests().map((r) => r.disposition)).toEqual(["scripted"]);
  });
});

describe("MockLlmProxy's capture observer", () => {
  it("hands every request to onCapture as it arrives, with its disposition and arrival time", async () => {
    const seen: CapturedLlmRequest[] = [];
    const observed = new MockLlmProxy({ onCapture: (request) => seen.push(request) });
    await observed.start();
    try {
      observed.enqueue(anthropicText("scripted"));
      const before = Date.now();
      await fetch(`${observed.url()}${ANTHROPIC_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", messages: [] }),
      });
      await fetch(`${observed.url()}/v1/proxy/llm/openai/v1/chat/completions`, { method: "POST", body: "{}" });
      expect(seen.map((request) => request.disposition)).toEqual(["scripted", "fenced"]);
      expect(seen).toEqual(observed.requests());
      for (const request of seen) {
        expect(request.receivedAt).toBeGreaterThanOrEqual(before);
        expect(request.receivedAt).toBeLessThanOrEqual(Date.now());
      }
    } finally {
      await observed.close();
    }
  });
});

describe("MockLlmProxy held turns", () => {
  const HELD_MS = 30_000;

  it("stamps hungUpAt on a held call its caller hangs up, the moment it hangs up", async () => {
    mock.enqueue(anthropicText("never sent"), { delayMs: HELD_MS });
    const caller = new AbortController();
    const pending = fetch(`${mock.url()}${ANTHROPIC_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "m", messages: [] }),
      signal: caller.signal,
    }).catch(() => undefined);
    await pollFor(() => mock.scriptedRequests().length === 1);
    const hungUp = Date.now();
    caller.abort();
    await pending;

    await pollFor(() => mock.scriptedRequests()[0]!.hungUpAt !== undefined);
    const held = mock.scriptedRequests()[0]!;
    expect(held.hungUpAt!, "stamped when the caller hung up, not when the hold would have ended").toBeLessThan(hungUp + 5_000);
    expect(held.hungUpAt!).toBeGreaterThanOrEqual(hungUp);
    expect(mock.consumed(), "the abandoned turn stays consumed").toBe(1);
  });

  it("serves a held call releaseHolds() ends, and leaves hungUpAt unset", async () => {
    mock.enqueue(anthropicText("released"), { delayMs: HELD_MS });
    const answer = post(ANTHROPIC_PATH, { model: "m", messages: [] });
    await pollFor(() => mock.scriptedRequests().length === 1);
    mock.releaseHolds();

    const response = await answer;
    expect(response.status).toBe(200);
    expect(((await response.json()) as { content: { text: string }[] }).content[0]!.text).toBe("released");
    expect(mock.scriptedRequests()[0]!.hungUpAt, "a release is not a hang-up").toBeUndefined();
  });
});

// Polls `done` every 10ms for up to 5s; the held-turn arms wait on the mock's
// own record rather than a fixed sleep.
async function pollFor(done: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!done()) {
    if (Date.now() > deadline) throw new Error("condition not met within 5s");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("MockLlmProxy bind host", () => {
  it("listens where it is bound, and urlAt() names the port under the host a runner reaches it by", async () => {
    const everywhere = new MockLlmProxy({ bindHost: "0.0.0.0" });
    await everywhere.start();
    try {
      everywhere.enqueue(anthropicText("reached"));
      const port = new URL(everywhere.url()).port;
      expect(everywhere.urlAt("host.docker.internal")).toBe(`http://host.docker.internal:${port}`);
      const response = await fetch(`${everywhere.urlAt("127.0.0.1")}${ANTHROPIC_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }] }),
      });
      expect(response.status).toBe(200);
      expect(everywhere.remaining(), "the request took the scripted turn").toBe(0);
    } finally {
      await everywhere.close();
    }
  });
});
