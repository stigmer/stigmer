// Unit arms for the mock LLM proxy's wire behavior — the surfaces the
// execution suites script and observe, driven over loopback with no runner.
// Domain: conformance harness (execution engine).
//
// Pinned here (entry 20260910.02): the opt-in embeddings carve-out keeps the
// default (fenced) posture the memory-retrieval suite relies on and, when
// enabled, answers by computation with the ordering property the
// memory-selection arms assert on; an injected error carries the scripted
// status, headers and body as JSON even for a streaming request; and
// requestModels() reads the id the provider saw off every captured request.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_ERROR_BODY,
  MockLlmProxy,
  anthropicText,
  deterministicEmbeddings,
  type EmbeddingsResponseBody,
} from "../mock-llm";

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
