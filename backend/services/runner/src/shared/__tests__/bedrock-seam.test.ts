/**
 * Characterization test for the ChatAnthropic `createClient` ->
 * AnthropicBedrock seam — the integration the T04 bedrock backend adapter
 * is built on. Sibling of vertex-seam.test.ts; same rules: this pins REAL
 * cross-package behavior (`@langchain/anthropic` driving
 * `@anthropic-ai/bedrock-sdk`, both resolving the single override-pinned
 * @anthropic-ai/sdk copy), so a future bump of either side fails here in
 * CI instead of in production. See scripts/check-langchain-deps.sh for
 * the override rationale and the single-copy invariant it guards.
 *
 * Determinism: zero live credentials, zero network. SigV4 signing runs for
 * real — it is pure HMAC over static test keys passed through the SDK's
 * own `awsAccessKey`/`awsSecretKey` options (the AWS credential provider
 * chain is bypassed entirely, so no IMDS/config-file probing) — and
 * transport is a recording `fetch` injected through the SDK's `fetch`
 * option. Streaming fixtures are binary AWS EventStream frames built with
 * the SDK's OWN exported marshaller (getMinimalSerdeContext), so the
 * EventStream -> SSE normalization path that every real Bedrock stream
 * takes is exercised, not bypassed.
 */

import { describe, it, expect } from "vitest";
import { ChatAnthropic } from "@langchain/anthropic";
import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import { getMinimalSerdeContext } from "@anthropic-ai/bedrock-sdk/core/streaming";
import { HumanMessage, AIMessage, AIMessageChunk } from "@langchain/core/messages";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/**
 * Bedrock's id form for a dated pre-4.6 Claude: `anthropic.` vendor prefix
 * and `-v1:0` version suffix (see llm-backend.ts translation, T04).
 */
const BEDROCK_MODEL_ID = "anthropic.claude-sonnet-4-5-20250929-v1:0";
const REGION = "asia-south1";
const ACCESS_KEY = "AKIA-SEAM-TEST";
const SECRET_KEY = "seam-test-secret";

const WEATHER_TOOL = {
  name: "get_weather",
  description: "Get the current weather for a city.",
  input_schema: {
    type: "object" as const,
    properties: { city: { type: "string" } },
    required: ["city"],
  },
};

/** Non-streaming (`/invoke`) response: text + tool_use + usage. */
const MESSAGE_RESPONSE = {
  id: "msg_bedrock_test_01",
  type: "message",
  role: "assistant",
  model: BEDROCK_MODEL_ID,
  content: [
    { type: "text", text: "I'll check the weather." },
    { type: "tool_use", id: "toolu_test_01", name: "get_weather", input: { city: "Chennai" } },
  ],
  stop_reason: "tool_use",
  stop_sequence: null,
  usage: { input_tokens: 25, output_tokens: 17 },
};

/**
 * Streaming (`/invoke-with-response-stream`) events in Anthropic's grammar.
 * On the Bedrock wire each rides base64-encoded inside a binary EventStream
 * `chunk` frame; the SDK's eventStreamToSSEResponse turns them back into
 * the SSE the nested @anthropic-ai/sdk parses.
 */
const STREAM_EVENTS: ReadonlyArray<Record<string, unknown>> = [
  {
    type: "message_start",
    message: {
      id: "msg_bedrock_test_02", type: "message", role: "assistant",
      model: BEDROCK_MODEL_ID, content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 25, output_tokens: 1 },
    },
  },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "I'll check the weather." } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_test_02", name: "get_weather", input: {} } },
  { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"city":"Chennai"}' } },
  { type: "content_block_stop", index: 1 },
  { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 17 } },
  { type: "message_stop" },
];

/**
 * Serialize Anthropic events into Bedrock's binary EventStream framing
 * using the SDK's own marshaller — the same codec its deserializer runs —
 * so the fixture is wire-faithful by construction, not by hand-rolling.
 */
async function binaryEventStreamBody(
  events: ReadonlyArray<Record<string, unknown>>,
): Promise<Buffer> {
  const { eventStreamMarshaller } = getMinimalSerdeContext();
  async function* input(): AsyncGenerator<Record<string, unknown>> {
    yield* events;
  }
  const serialized = eventStreamMarshaller.serialize(input(), (event) => ({
    headers: {
      ":event-type": { type: "string", value: "chunk" },
      ":message-type": { type: "string", value: "event" },
      ":content-type": { type: "string", value: "application/json" },
    },
    body: new TextEncoder().encode(
      JSON.stringify({ bytes: Buffer.from(JSON.stringify(event)).toString("base64") }),
    ),
  }));
  const chunks: Buffer[] = [];
  for await (const chunk of serialized) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
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
  /** The AnthropicBedrock instances the factory constructed. */
  clients: AnthropicBedrock[];
}

/**
 * Build a real ChatAnthropic wired to a real AnthropicBedrock through the
 * `createClient` seam, with transport replaced by a recording fetch.
 *
 * The factory honors `maxRetries` from the incoming options: LangChain owns
 * retrying (its AsyncCaller wraps every request) and passes `maxRetries: 0`
 * so the underlying SDK must not retry underneath it — same contract the
 * vertex seam pins, preserved by the T04 adapter.
 */
function buildSeamHarness(streamBody?: Buffer): SeamHarness {
  const requests: RecordedRequest[] = [];
  const factoryOptions: SeamHarness["factoryOptions"] = [];
  const clients: AnthropicBedrock[] = [];

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
    const streaming = String(input).includes("invoke-with-response-stream");
    return streaming
      ? new Response(streamBody, {
          status: 200,
          // The real Bedrock wire content type — adaptResponse matches it
          // positively and transcodes the binary frames back to SSE.
          headers: { "Content-Type": "application/vnd.amazon.eventstream" },
        })
      : new Response(JSON.stringify(MESSAGE_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
  };

  const model = new ChatAnthropic({
    model: BEDROCK_MODEL_ID,
    temperature: 0,
    maxTokens: 1024,
    createClient: (options) => {
      factoryOptions.push({ maxRetries: options.maxRetries });
      const client = new AnthropicBedrock({
        awsRegion: REGION,
        awsAccessKey: ACCESS_KEY,
        awsSecretKey: SECRET_KEY,
        fetch: recordingFetch,
        maxRetries: options.maxRetries,
      });
      clients.push(client);
      return client;
    },
  });

  return { model, requests, factoryOptions, clients };
}

/**
 * Bedrock moves the model id into the URL path. Pinned: the installed
 * 0.32.x interpolates it UNENCODED — the `-v1:0` colon stays literal in
 * the path (newer SDK source URI-encodes via its `path` template helper;
 * if an upgrade flips this to `%3A`, AWS accepts both, but this pin makes
 * the change visible instead of silent).
 */
const expectedUrl = (specifier: "invoke" | "invoke-with-response-stream") =>
  `https://bedrock-runtime.${REGION}.amazonaws.com/model/` +
  `${BEDROCK_MODEL_ID}/${specifier}`;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ChatAnthropic createClient -> AnthropicBedrock seam", () => {
  it("constructs without an Anthropic API key when createClient is provided", () => {
    // chat_models.js waives the "Anthropic API key not found" check for
    // factory-constructed clients — the waiver the bedrock backend depends on.
    expect(() => buildSeamHarness()).not.toThrow();
  });

  it("defaults awsRegion to us-east-1 when AWS_REGION is unset (why preflight requires it)", () => {
    // Pinned deliberately: the SDK will happily route traffic to us-east-1
    // on a missing region. For a deployment-controlled data-residency
    // feature that silent cross-region default is unacceptable, so
    // checkBedrockPrerequisites (llm-backend.ts) refuses to start without
    // an explicit AWS_REGION. If the SDK ever drops the default, this test
    // tells us the preflight rationale needs rewording.
    const saved = process.env.AWS_REGION;
    delete process.env.AWS_REGION;
    try {
      const client = new AnthropicBedrock({
        awsAccessKey: ACCESS_KEY,
        awsSecretKey: SECRET_KEY,
      });
      expect(client.awsRegion).toBe("us-east-1");
    } finally {
      if (saved !== undefined) process.env.AWS_REGION = saved;
    }
  });

  it("shapes a non-streaming request into Bedrock wire form (/invoke) and SigV4-signs it", async () => {
    const h = buildSeamHarness();

    const result = await h.model.invoke([new HumanMessage("Weather in Chennai?")]);

    expect(h.requests).toHaveLength(1);
    const req = h.requests[0];

    // Model id rides in the URL path (URI-encoded), never in the body;
    // stream flag is likewise URL routing, not body content.
    expect(req.url).toBe(expectedUrl("invoke"));
    expect(req.method).toBe("POST");
    expect(req.body).not.toHaveProperty("model");
    expect(req.body).not.toHaveProperty("stream");
    expect(req.body.anthropic_version).toBe("bedrock-2023-05-31");
    expect(req.body.max_tokens).toBe(1024);

    // SigV4 signature over the adapted request reached the wire, scoped to
    // the region and the bedrock service — the signature must cover the
    // FINAL (middleware-adapted) request or AWS rejects it.
    expect(req.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(req.headers.authorization).toContain(`/${REGION}/bedrock/aws4_request`);
    expect(req.headers["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);

    expect(result).toBeInstanceOf(AIMessage);
  });

  it("round-trips tool definitions and tool_use blocks into tool_calls", async () => {
    const h = buildSeamHarness();
    const withTools = h.model.bindTools([WEATHER_TOOL]);

    const result = (await withTools.invoke([
      new HumanMessage("Weather in Chennai?"),
    ])) as AIMessage;

    // Tool definition survived request shaping through the Bedrock adapter.
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

  it("streams via /invoke-with-response-stream, transcoding EventStream frames to tool_calls and usage", async () => {
    const h = buildSeamHarness(await binaryEventStreamBody(STREAM_EVENTS));

    let final: AIMessageChunk | undefined;
    for await (const chunk of await h.model.stream([
      new HumanMessage("Weather in Chennai?"),
    ])) {
      final = final === undefined ? chunk : final.concat(chunk);
    }

    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].url).toBe(expectedUrl("invoke-with-response-stream"));
    expect(h.requests[0].body).not.toHaveProperty("stream");
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
    // Pinned to the observed accumulation (same math the vertex seam pins)
    // so a LangChain bump that changes usage accounting fails here first.
    expect(final?.usage_metadata).toMatchObject({
      input_tokens: 25,
      output_tokens: 18,
    });
  });

  it("passes maxRetries: 0 to the factory and the honored value reaches the client", async () => {
    const h = buildSeamHarness(await binaryEventStreamBody(STREAM_EVENTS));

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

  it("cannot serve countTokens: the request is never adapted to a Bedrock route", async () => {
    // Bedrock supports neither token counting nor prompt caching — a
    // documented limitation of the bedrock backend (operator doc,
    // docs/guides/runners/model-backends.mdx). The installed 0.32.x still
    // EXPOSES messages.countTokens (newer SDK source deletes the resource
    // at construction), but its request bypasses the /model/… rewrite —
    // MODEL_ENDPOINTS covers only /v1/complete and /v1/messages — so it
    // targets a path that does not exist on the Bedrock runtime and can
    // never succeed against AWS. Pinned so an SDK upgrade that either
    // deletes the method or starts adapting it surfaces here, prompting a
    // docs review instead of silent drift.
    const requests: string[] = [];
    const notFoundFetch: typeof fetch = async (input) => {
      requests.push(String(input));
      return new Response("{}", { status: 404 });
    };
    const client = new AnthropicBedrock({
      awsRegion: REGION,
      awsAccessKey: ACCESS_KEY,
      awsSecretKey: SECRET_KEY,
      fetch: notFoundFetch,
      maxRetries: 0,
    });

    // 0.32.x quirk: the TYPES already omit countTokens while the RUNTIME
    // still exposes it — the cast reaches the runtime truth this test pins.
    const messages = client.messages as unknown as {
      countTokens: (req: Record<string, unknown>) => Promise<unknown>;
    };
    await expect(
      messages.countTokens({
        model: BEDROCK_MODEL_ID,
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow();
    expect(requests).toHaveLength(1);
    // Anthropic-shaped path on the Bedrock host — not a /model/… route.
    expect(requests[0]).toBe(
      `https://bedrock-runtime.${REGION}.amazonaws.com/v1/messages/count_tokens`,
    );
  });
});
