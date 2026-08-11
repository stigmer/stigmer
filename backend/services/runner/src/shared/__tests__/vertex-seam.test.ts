/**
 * Characterization test for the ChatAnthropic `createClient` -> AnthropicVertex
 * seam — the integration T02's vertex backend adapter will be built on.
 *
 * This is NOT a unit test of our code (there is no production vertex code
 * yet). It pins the exact cross-package behavior production will rely on:
 * the REAL `ChatAnthropic` (@langchain/anthropic, bundling @anthropic-ai/sdk
 * 0.95.x) driving the REAL `AnthropicVertex` client (@anthropic-ai/vertex-sdk,
 * bundling its own nested @anthropic-ai/sdk >=0.115). If a future bump of
 * either side changes request shaping, streaming event handling, tool-call
 * assembly, or usage accounting across this seam, this suite fails in CI
 * instead of production. See scripts/check-langchain-deps.sh for why two
 * @anthropic-ai/sdk copies coexist and when they collapse to one.
 *
 * Determinism: zero credentials, zero network. Google auth is bypassed by
 * injecting a fake `authClient` (the SDK's supported constructor option —
 * `accessToken` alone does NOT skip the auth client, adaptRequest always
 * awaits it), and transport is a recording `fetch` injected through the
 * SDK's own `fetch` option. No global patching, no SDK mocks.
 */

import { describe, it, expect } from "vitest";
import { ChatAnthropic } from "@langchain/anthropic";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import type { AuthClient } from "google-auth-library";
import { HumanMessage, AIMessage, AIMessageChunk } from "@langchain/core/messages";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Dated pre-4.6 id in Vertex's `@date` form (see llm-backend.ts translation). */
const VERTEX_MODEL_ID = "claude-sonnet-4-5@20250929";
const PROJECT_ID = "test-project";
const REGION = "asia-south1";

const WEATHER_TOOL = {
  name: "get_weather",
  description: "Get the current weather for a city.",
  input_schema: {
    type: "object" as const,
    properties: { city: { type: "string" } },
    required: ["city"],
  },
};

/** Non-streaming (`:rawPredict`) response: text + tool_use + usage. */
const MESSAGE_RESPONSE = {
  id: "msg_vertex_test_01",
  type: "message",
  role: "assistant",
  model: VERTEX_MODEL_ID,
  content: [
    { type: "text", text: "I'll check the weather." },
    { type: "tool_use", id: "toolu_test_01", name: "get_weather", input: { city: "Chennai" } },
  ],
  stop_reason: "tool_use",
  stop_sequence: null,
  usage: { input_tokens: 25, output_tokens: 17 },
};

/**
 * Streaming (`:streamRawPredict`) response as Anthropic SSE: a text block,
 * a tool_use block assembled from input_json_delta, then cumulative usage in
 * message_delta — the exact event grammar the nested SDK parses.
 */
const SSE_EVENTS: ReadonlyArray<[string, object]> = [
  ["message_start", {
    type: "message_start",
    message: {
      id: "msg_vertex_test_02", type: "message", role: "assistant",
      model: VERTEX_MODEL_ID, content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 25, output_tokens: 1 },
    },
  }],
  ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "I'll check the weather." } }],
  ["content_block_stop", { type: "content_block_stop", index: 0 }],
  ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_test_02", name: "get_weather", input: {} } }],
  ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"city":"Chennai"}' } }],
  ["content_block_stop", { type: "content_block_stop", index: 1 }],
  ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 17 } }],
  ["message_stop", { type: "message_stop" }],
];

function sseBody(): string {
  return SSE_EVENTS
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
}

// ─── Harness ─────────────────────────────────────────────────────────────────

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

interface SeamHarness {
  model: ChatAnthropic;
  requests: RecordedRequest[];
  /** Options ChatAnthropic passed to the createClient factory. */
  factoryOptions: Array<{ maxRetries?: number }>;
  /** The AnthropicVertex instances the factory constructed. */
  clients: AnthropicVertex[];
}

/**
 * Build a real ChatAnthropic wired to a real AnthropicVertex through the
 * `createClient` seam, with transport replaced by a recording fetch.
 *
 * The factory honors `maxRetries` from the incoming options: LangChain owns
 * retrying (its AsyncCaller wraps every request) and passes `maxRetries: 0`
 * so the underlying SDK must not retry underneath it. A factory that ignored
 * this would nest the Vertex SDK's default 2 retries inside LangChain's loop,
 * multiplying every transient failure — the T02 adapter must preserve this.
 */
function buildSeamHarness(): SeamHarness {
  const requests: RecordedRequest[] = [];
  const factoryOptions: SeamHarness["factoryOptions"] = [];
  const clients: AnthropicVertex[] = [];

  const recordingFetch: typeof fetch = async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const streaming = String(input).includes(":streamRawPredict");
    return streaming
      ? new Response(sseBody(), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      : new Response(JSON.stringify(MESSAGE_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
  };

  // Minimal structural fake of google-auth-library's AuthClient — the Vertex
  // SDK's adaptRequest calls exactly `getRequestHeaders()` (merged into the
  // outbound request) and reads `projectId`. The cast is test-only: building
  // a real AuthClient would require credentials, defeating determinism.
  const fakeAuthClient = {
    projectId: PROJECT_ID,
    getRequestHeaders: async () => new Headers({ authorization: "Bearer test-token" }),
  } as unknown as AuthClient;

  const model = new ChatAnthropic({
    model: VERTEX_MODEL_ID,
    temperature: 0,
    maxTokens: 1024,
    createClient: (options) => {
      factoryOptions.push({ maxRetries: options.maxRetries });
      const client = new AnthropicVertex({
        projectId: PROJECT_ID,
        region: REGION,
        authClient: fakeAuthClient,
        fetch: recordingFetch,
        maxRetries: options.maxRetries,
      });
      clients.push(client);
      return client;
    },
  });

  return { model, requests, factoryOptions, clients };
}

const expectedUrl = (specifier: "rawPredict" | "streamRawPredict") =>
  `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}` +
  `/locations/${REGION}/publishers/anthropic/models/${VERTEX_MODEL_ID}:${specifier}`;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ChatAnthropic createClient -> AnthropicVertex seam", () => {
  it("constructs without an Anthropic API key when createClient is provided", () => {
    // chat_models.js waives the "Anthropic API key not found" check for
    // factory-constructed clients — the waiver the vertex backend depends on.
    expect(() => buildSeamHarness()).not.toThrow();
  });

  it("shapes a non-streaming request into Vertex wire form (:rawPredict)", async () => {
    const h = buildSeamHarness();

    const result = await h.model.invoke([new HumanMessage("Weather in Chennai?")]);

    expect(h.requests).toHaveLength(1);
    const req = h.requests[0];

    // The model id rides in the URL path — with `@` intact — not in the body.
    expect(req.url).toBe(expectedUrl("rawPredict"));
    expect(req.method).toBe("POST");
    expect(req.body).not.toHaveProperty("model");
    expect(req.body.anthropic_version).toBe("vertex-2023-10-16");
    expect(req.body.max_tokens).toBe(1024);

    // The fake auth client's OAuth header reached the wire.
    expect(req.headers.authorization).toBe("Bearer test-token");

    expect(result).toBeInstanceOf(AIMessage);
  });

  it("round-trips tool definitions and tool_use blocks into tool_calls", async () => {
    const h = buildSeamHarness();
    const withTools = h.model.bindTools([WEATHER_TOOL]);

    const result = (await withTools.invoke([
      new HumanMessage("Weather in Chennai?"),
    ])) as AIMessage;

    // Tool definition survived request shaping through the Vertex adapter.
    const tools = h.requests[0].body.tools as Array<{ name: string }>;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("get_weather");

    // The tool_use response block became a LangChain tool_call with its id —
    // the identity the HITL approval flow keys on.
    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls?.[0]).toMatchObject({
      id: "toolu_test_01",
      name: "get_weather",
      args: { city: "Chennai" },
    });
  });

  it("reports usage_metadata on non-streaming responses (what billing reads)", async () => {
    const h = buildSeamHarness();

    const result = (await h.model.invoke([
      new HumanMessage("Weather in Chennai?"),
    ])) as AIMessage;

    expect(result.usage_metadata).toMatchObject({
      input_tokens: 25,
      output_tokens: 17,
      total_tokens: 42,
    });
  });

  it("streams via :streamRawPredict, assembling tool_calls and usage from SSE", async () => {
    const h = buildSeamHarness();

    let final: AIMessageChunk | undefined;
    for await (const chunk of await h.model.stream([
      new HumanMessage("Weather in Chennai?"),
    ])) {
      final = final === undefined ? chunk : final.concat(chunk);
    }

    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].url).toBe(expectedUrl("streamRawPredict"));
    expect(h.requests[0].body.stream).toBe(true);
    expect(h.requests[0].body).not.toHaveProperty("model");

    expect(final).toBeDefined();
    expect(final?.text).toBe("I'll check the weather.");
    expect(final?.tool_calls).toHaveLength(1);
    expect(final?.tool_calls?.[0]).toMatchObject({
      id: "toolu_test_02",
      name: "get_weather",
      args: { city: "Chennai" },
    });

    // input from message_start; output accumulated across message events.
    // Pinned to the observed accumulation so a LangChain bump that changes
    // usage math (billing input) fails here first.
    expect(final?.usage_metadata).toMatchObject({
      input_tokens: 25,
      output_tokens: 18,
    });
  });

  it("passes maxRetries: 0 to the factory and the honored value reaches the client", async () => {
    const h = buildSeamHarness();

    await h.model.invoke([new HumanMessage("hi")]);
    for await (const chunk of await h.model.stream([new HumanMessage("hi")])) {
      void chunk;
    }

    // LangChain owns retrying: it must hand the factory maxRetries: 0, once
    // per cached client (batch + streaming are constructed independently).
    expect(h.factoryOptions).toHaveLength(2);
    expect(h.factoryOptions.every((o) => o.maxRetries === 0)).toBe(true);
    expect(h.clients).toHaveLength(2);
    expect(h.clients.every((c) => c.maxRetries === 0)).toBe(true);
  });
});
