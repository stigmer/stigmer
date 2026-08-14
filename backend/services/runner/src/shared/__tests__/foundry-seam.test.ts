/**
 * Characterization test for the ChatAnthropic `createClient` ->
 * AnthropicFoundry seam — the integration the T05 foundry backend adapter
 * is built on. Sibling of vertex-seam.test.ts and bedrock-seam.test.ts;
 * same rules: this pins REAL cross-package behavior (`@langchain/anthropic`
 * driving `@anthropic-ai/foundry-sdk`, both resolving the single
 * override-pinned @anthropic-ai/sdk copy), so a future bump of either
 * side fails here in CI instead of in production. See
 * scripts/check-langchain-deps.sh for the override rationale and the
 * single-copy invariant it guards.
 *
 * Determinism: zero live credentials, zero network. API-key auth is a
 * static test key; Entra ID auth is a fake `azureADTokenProvider` (the
 * SDK's supported constructor option — a plain `() => Promise<string>`,
 * so no @azure/identity is needed here); transport is a recording `fetch`
 * injected through the SDK's own `fetch` option.
 *
 * Foundry-specific wire facts this suite pins (vs. its two siblings):
 *   - The deployment name stays in the BODY as `model` — Foundry routes by
 *     deployment name, not by URL path (Vertex/Bedrock move the id into
 *     the path). One /v1/messages URL serves both modes; `stream: true`
 *     in the body selects streaming.
 *   - The constructor enforces its config contract itself: a credential
 *     (apiKey XOR azureADTokenProvider) and an endpoint (resource XOR
 *     baseURL) are both mandatory, each pair mutually exclusive. These
 *     throws are what checkFoundryPrerequisites front-runs at boot.
 *   - withStructuredOutput compiles to forced tool use (tools +
 *     tool_choice), NOT Anthropic's native structured-output parameter —
 *     which is why it works on "Hosted on Azure" Foundry deployments,
 *     where the native feature returns 400 by design (operator doc,
 *     docs/guides/runners/model-backends.mdx).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ChatAnthropic } from "@langchain/anthropic";
import { AnthropicFoundry } from "@anthropic-ai/foundry-sdk";
import { HumanMessage, AIMessage, AIMessageChunk } from "@langchain/core/messages";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/**
 * Foundry's default deployment names are the DATELESS Claude ids — this is
 * a dated registry id after the strip-date translation in llm-backend.ts
 * (claude-sonnet-4-5-20250929 -> claude-sonnet-4-5).
 */
const FOUNDRY_DEPLOYMENT = "claude-sonnet-4-5";
const RESOURCE = "seam-test-resource";
const API_KEY = "foundry-seam-test-key";

const WEATHER_TOOL = {
  name: "get_weather",
  description: "Get the current weather for a city.",
  input_schema: {
    type: "object" as const,
    properties: { city: { type: "string" } },
    required: ["city"],
  },
};

/** Non-streaming response: text + tool_use + usage. */
const MESSAGE_RESPONSE = {
  id: "msg_foundry_test_01",
  type: "message",
  role: "assistant",
  model: FOUNDRY_DEPLOYMENT,
  content: [
    { type: "text", text: "I'll check the weather." },
    { type: "tool_use", id: "toolu_test_01", name: "get_weather", input: { city: "Chennai" } },
  ],
  stop_reason: "tool_use",
  stop_sequence: null,
  usage: { input_tokens: 25, output_tokens: 17 },
};

/**
 * Streaming response as Anthropic SSE — Foundry speaks the standard
 * Messages API event grammar (no transcoding layer like Bedrock's binary
 * EventStream): a text block, a tool_use block assembled from
 * input_json_delta, then cumulative usage in message_delta.
 */
const SSE_EVENTS: ReadonlyArray<[string, object]> = [
  ["message_start", {
    type: "message_start",
    message: {
      id: "msg_foundry_test_02", type: "message", role: "assistant",
      model: FOUNDRY_DEPLOYMENT, content: [], stop_reason: null, stop_sequence: null,
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

// ─── Env hygiene ─────────────────────────────────────────────────────────────

/**
 * The AnthropicFoundry constructor reads these as option defaults, so a
 * developer machine with a real Foundry setup would silently change what
 * the constructor-contract tests observe. Cleared for every test; the
 * harness passes everything explicitly.
 */
const FOUNDRY_ENV_VARS = [
  "ANTHROPIC_FOUNDRY_API_KEY",
  "ANTHROPIC_FOUNDRY_RESOURCE",
  "ANTHROPIC_FOUNDRY_BASE_URL",
] as const;

const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const name of FOUNDRY_ENV_VARS) {
    savedEnv.set(name, process.env[name]);
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of FOUNDRY_ENV_VARS) {
    const value = savedEnv.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

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
  /** The AnthropicFoundry instances the factory constructed. */
  clients: AnthropicFoundry[];
}

/**
 * Build a real ChatAnthropic wired to a real AnthropicFoundry through the
 * `createClient` seam, with transport replaced by a recording fetch.
 *
 * The factory honors `maxRetries` from the incoming options: LangChain owns
 * retrying (its AsyncCaller wraps every request) and passes `maxRetries: 0`
 * so the underlying SDK must not retry underneath it — same contract the
 * vertex and bedrock seams pin, preserved by the T05 adapter.
 *
 * Auth is either the static test API key or a caller-supplied Entra token
 * provider — the same either/or the production adapter selects between.
 */
function buildSeamHarness(auth?: { azureADTokenProvider: () => Promise<string> }): SeamHarness {
  const requests: RecordedRequest[] = [];
  const factoryOptions: SeamHarness["factoryOptions"] = [];
  const clients: AnthropicFoundry[] = [];

  const recordingFetch: typeof fetch = async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body,
    });
    // One URL serves both modes on Foundry — the body's stream flag picks.
    return body.stream === true
      ? new Response(sseBody(), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      : new Response(JSON.stringify(MESSAGE_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
  };

  const model = new ChatAnthropic({
    model: FOUNDRY_DEPLOYMENT,
    temperature: 0,
    maxTokens: 1024,
    createClient: (options) => {
      factoryOptions.push({ maxRetries: options.maxRetries });
      const client = new AnthropicFoundry({
        resource: RESOURCE,
        ...(auth ?? { apiKey: API_KEY }),
        fetch: recordingFetch,
        maxRetries: options.maxRetries,
      });
      clients.push(client);
      return client;
    },
  });

  return { model, requests, factoryOptions, clients };
}

/** Foundry's one Messages URL: resource-derived host, /anthropic prefix. */
const EXPECTED_URL =
  `https://${RESOURCE}.services.ai.azure.com/anthropic/v1/messages`;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ChatAnthropic createClient -> AnthropicFoundry seam", () => {
  it("constructs without an Anthropic API key when createClient is provided", () => {
    // chat_models.js waives the "Anthropic API key not found" check for
    // factory-constructed clients — the waiver the foundry backend depends on.
    expect(() => buildSeamHarness()).not.toThrow();
  });

  it("enforces its config contract in the constructor (what preflight front-runs)", () => {
    // These four throws are the SDK's own; checkFoundryPrerequisites
    // (llm-backend.ts) exists to catch the endpoint half at boot with the
    // catalog message instead of at the first model call. The credential
    // half resolves at construction (key if present, else Entra chain), so
    // the "missing credentials" arm is unreachable in production — pinned
    // here so an SDK contract change surfaces as a failing pin.
    expect(() => new AnthropicFoundry({ resource: RESOURCE })).toThrow(
      /Missing credentials/,
    );
    expect(
      () =>
        new AnthropicFoundry({
          resource: RESOURCE,
          apiKey: API_KEY,
          azureADTokenProvider: async () => "token",
        }),
    ).toThrow(/mutually exclusive/);
    expect(() => new AnthropicFoundry({ apiKey: API_KEY })).toThrow(
      /baseURL.*resource|resource.*baseURL/,
    );
    expect(
      () =>
        new AnthropicFoundry({
          apiKey: API_KEY,
          resource: RESOURCE,
          baseURL: "https://example.services.ai.azure.com/anthropic/",
        }),
    ).toThrow(/mutually exclusive/);
  });

  it("shapes a non-streaming request: deployment name in the BODY, key in x-api-key", async () => {
    const h = buildSeamHarness();

    const result = await h.model.invoke([new HumanMessage("Weather in Chennai?")]);

    expect(h.requests).toHaveLength(1);
    const req = h.requests[0];

    // Unlike Vertex/Bedrock, the model field survives in the body — it IS
    // the routing key (the deployment name). The URL never carries it.
    expect(req.url).toBe(EXPECTED_URL);
    expect(req.method).toBe("POST");
    expect(req.body.model).toBe(FOUNDRY_DEPLOYMENT);
    expect(req.body.max_tokens).toBe(1024);

    // API-key mode authenticates with x-api-key (Entra uses Authorization:
    // Bearer — pinned separately); the standard version header rides along.
    expect(req.headers["x-api-key"]).toBe(API_KEY);
    expect(req.headers.authorization).toBeUndefined();
    expect(req.headers["anthropic-version"]).toBe("2023-06-01");

    expect(result).toBeInstanceOf(AIMessage);
  });

  it("round-trips tool definitions and tool_use blocks into tool_calls", async () => {
    const h = buildSeamHarness();
    const withTools = h.model.bindTools([WEATHER_TOOL]);

    const result = (await withTools.invoke([
      new HumanMessage("Weather in Chennai?"),
    ])) as AIMessage;

    // Tool definition survived request shaping through the Foundry client.
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

  it("streams over the same URL with stream: true, assembling tool_calls and usage from SSE", async () => {
    const h = buildSeamHarness();

    let final: AIMessageChunk | undefined;
    for await (const chunk of await h.model.stream([
      new HumanMessage("Weather in Chennai?"),
    ])) {
      final = final === undefined ? chunk : final.concat(chunk);
    }

    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].url).toBe(EXPECTED_URL);
    expect(h.requests[0].body.stream).toBe(true);
    expect(h.requests[0].body.model).toBe(FOUNDRY_DEPLOYMENT);

    expect(final).toBeDefined();
    expect(final?.text).toBe("I'll check the weather.");
    expect(final?.tool_calls).toHaveLength(1);
    expect(final?.tool_calls?.[0]).toMatchObject({
      id: "toolu_test_02",
      name: "get_weather",
      args: { city: "Chennai" },
    });

    // input from message_start; output accumulated across message events.
    // Pinned to the observed accumulation (same math the vertex and bedrock
    // seams pin) so a LangChain bump that changes usage accounting (billing
    // input) fails here first.
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

  it("Entra mode: sends Authorization: Bearer, invoking the provider per request", async () => {
    // The provider must be consulted on EVERY request, never cached by the
    // SDK — Entra tokens expire, and a long-lived runner that cached one
    // would start failing an hour in. Pinned by counting invocations.
    let calls = 0;
    const h = buildSeamHarness({
      azureADTokenProvider: async () => {
        calls += 1;
        return `entra-token-${calls}`;
      },
    });

    await h.model.invoke([new HumanMessage("hi")]);
    await h.model.invoke([new HumanMessage("hi again")]);

    expect(calls).toBe(2);
    expect(h.requests[0].headers.authorization).toBe("Bearer entra-token-1");
    expect(h.requests[1].headers.authorization).toBe("Bearer entra-token-2");
    expect(h.requests[0].headers["x-api-key"]).toBeUndefined();
  });

  it("Entra mode: a failing token provider throws the message model-error.ts matches", async () => {
    // The exact prefix is the LLM_BACKEND_CREDENTIALS matcher in
    // model-error.ts (isFoundryCredentialMessage) — it arrives with no HTTP
    // status, so classification must catch it by prose, like the Google ADC
    // and AWS chain failures. If an SDK bump rewords it, this pin fails
    // before the classifier silently degrades.
    const client = new AnthropicFoundry({
      resource: RESOURCE,
      azureADTokenProvider: async () => {
        throw new Error("ManagedIdentityCredential: no managed identity endpoint found");
      },
      maxRetries: 0,
    });

    await expect(
      client.messages.create({
        model: FOUNDRY_DEPLOYMENT,
        max_tokens: 16,
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/Failed to get token from azureADTokenProvider/);
  });

  it("withStructuredOutput compiles to forced tool use — no native structured-output param", async () => {
    // Load-bearing for the hosted-on-Azure deployment mode: Foundry
    // deployments hosted on Azure return 400 for Anthropic's NATIVE
    // structured-output feature, but plain tool use is fully supported.
    // LangChain implements withStructuredOutput as tools + tool_choice, so
    // every runner call site (call-llm, classify-tool-approvals, Cursor
    // extraction) works on either hosting mode. If a LangChain bump swaps
    // the implementation to the native parameter, this pin fails and the
    // operator doc's hosting-mode guidance must be revisited.
    const requests: Array<Record<string, unknown>> = [];
    const structuredFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      return new Response(
        JSON.stringify({
          ...MESSAGE_RESPONSE,
          content: [{
            type: "tool_use",
            id: "toolu_so_01",
            name: "record_weather",
            input: { city: "Chennai", temperature_c: 31 },
          }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const model = new ChatAnthropic({
      model: FOUNDRY_DEPLOYMENT,
      temperature: 0,
      maxTokens: 1024,
      createClient: (options) =>
        new AnthropicFoundry({
          resource: RESOURCE,
          apiKey: API_KEY,
          fetch: structuredFetch,
          maxRetries: options.maxRetries,
        }),
    });

    const structured = model.withStructuredOutput(
      {
        type: "object",
        properties: {
          city: { type: "string" },
          temperature_c: { type: "number" },
        },
        required: ["city", "temperature_c"],
      },
      { name: "record_weather" },
    );

    const result = await structured.invoke([new HumanMessage("Weather in Chennai?")]);

    expect(requests).toHaveLength(1);
    const body = requests[0];
    // The schema rides as a tool with a forced tool_choice…
    const tools = body.tools as Array<{ name: string }>;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("record_weather");
    expect(body.tool_choice).toMatchObject({ type: "tool", name: "record_weather" });
    // …and never as the native structured-output request fields.
    expect(body).not.toHaveProperty("output_format");
    expect(body).not.toHaveProperty("response_format");

    expect(result).toMatchObject({ city: "Chennai", temperature_c: 31 });
  });
});
