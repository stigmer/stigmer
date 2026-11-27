/**
 * LangChain's Google client, as the runner builds it, against a fake that
 * speaks Gemini's own wire (`test/support/src/mock-llm.ts` on Google's proxy
 * path): what the runner's Gemini models rest on, proven before anything is
 * built on them.
 *
 * Each case is one contract the agent loop needs from the client:
 *
 *  - Two steps of a tool call, streamed as the agent loop streams
 *    (`streamEvents`, v3). Google signs each function call and refuses a
 *    conversation that sends one back unsigned; the fake does the same, so
 *    the second step completes only when the signature survived the stream.
 *  - An approval pause: the tool-calling message is checkpointed (serialized
 *    and read back) before the tool runs, and the step after it is still
 *    signed.
 *  - Structured output by function calling, with thinking on.
 *  - An image sent as a data-URL block.
 *  - Usage on the stream's `message-finish`, thinking counted as output
 *    (the client's event stream leaves it out; the runner's model adds it).
 *  - A refused key, as the client raises it.
 *  - A passing failure (503) before the reply begins, retried by the request
 *    loop on the path the agent loop streams through (the client's event
 *    stream fetches outside it; the runner's model starts it inside).
 *
 * The live twin, `google-client.live.test.ts`, asks Google itself the
 * questions only Google answers.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { Command } from "@langchain/langgraph";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { createAgent, humanInTheLoopMiddleware, tool } from "langchain";
import { z } from "zod";
import {
  anthropicText,
  anthropicToolUse,
  MockLlmProxy,
  type AnthropicMessageBody,
} from "@stigmer/test-support/mock-llm";
import {
  geminiError,
  mockThoughtSignature,
  MOCK_THOUGHT_TOKENS_PER_BLOCK,
  readGeminiRequest,
  type GeminiRequestBody,
} from "@stigmer/test-support/llm-wire";

import { buildChatModel } from "../model-client.js";
import { _resetRegistryCache } from "../model-registry.js";
import { stubRegistryFetch } from "../../__test-utils__/model-registry-fixture.js";
import { usageOf, type V3UsagePayload } from "../../activities/execute-deep-agent/translator.js";
import type { V3ProtocolEvent } from "../../activities/execute-deep-agent/v3-event-recorder.js";
import { ThinkingMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

const MODEL = "google:gemini-3-flash";
const TOKEN = "run-credential";
// Each case names its own run: the mock retires every run a case spoke for
// once the case ends.
let runSeq = 0;
let executionId = "";

let mock: MockLlmProxy;
let registry: ReturnType<typeof stubRegistryFetch>;

beforeAll(async () => {
  mock = new MockLlmProxy();
  await mock.start();
  // The fixture registry knows no Gemini model, so the name passes through;
  // every other fetch (the mock) goes out.
  _resetRegistryCache();
  registry = stubRegistryFetch({ live: true });
});

beforeEach(() => {
  runSeq += 1;
  executionId = `run_google_client_${runSeq}`;
});

afterEach(() => mock.reset());

afterAll(async () => {
  registry.restore();
  await mock.close();
});

async function gemini(options: { thinking?: Parameters<typeof buildChatModel>[0]["thinking"] } = {}) {
  const built = await buildChatModel({
    modelName: MODEL,
    proxyEndpoint: mock.url(),
    stigmerToken: TOKEN,
    headerScope: { executionId },
    temperature: null,
    ...(options.thinking !== undefined ? { thinking: options.thinking } : {}),
  });
  return built.model;
}

const lookup = tool(async ({ city }: { city: string }) => `${city}: 21 degrees`, {
  name: "lookup_weather",
  description: "Look up the weather in a city.",
  schema: z.object({ city: z.string() }),
});

function withThinking(body: AnthropicMessageBody): AnthropicMessageBody {
  return { ...body, content: [{ type: "thinking", thinking: "the person asked for the weather" }, ...body.content] };
}

/** The Gemini bodies the agent loop sent, in order. */
function loopBodies(): GeminiRequestBody[] {
  return mock.scriptedRequests().map((request) => readGeminiRequest(request.body));
}

/** The function-call parts a request sends back, with the signature each carries. */
function sentCalls(body: GeminiRequestBody): Array<{ name: string; signature: string | undefined }> {
  return body.contents
    .filter((content) => content.role === "model")
    .flatMap((content) => content.parts)
    .filter((part) => part.functionCall !== undefined)
    .map((part) => ({ name: part.functionCall?.name ?? "", signature: part.thoughtSignature }));
}

/** The text of a run's last message. */
function lastText(state: { messages: BaseMessage[] }): string | undefined {
  return state.messages.at(-1)?.text;
}

async function streamAll(run: AsyncIterable<unknown>): Promise<V3ProtocolEvent[]> {
  const events: V3ProtocolEvent[] = [];
  for await (const event of run) events.push(event as V3ProtocolEvent);
  return events;
}

describe("the Google client as the runner builds it", () => {
  it("runs two steps of a tool call streamed as the agent loop streams, the signature sent back", async () => {
    mock.enqueue(anthropicToolUse("call_weather", "lookup_weather", { city: "Paris" })).enqueue(anthropicText("It is 21 degrees in Paris."));
    const agent = createAgent({ model: await gemini(), tools: [lookup] });

    const run = await agent.streamEvents({ messages: [new HumanMessage("What is the weather in Paris?")] }, { version: "v3" });
    await streamAll(run as AsyncIterable<unknown>);
    const state = await (run as { output: Promise<{ messages: BaseMessage[] }> }).output;

    expect(mock.describeTraffic()).not.toContain("refused");
    const bodies = loopBodies();
    expect(bodies).toHaveLength(2);
    expect(sentCalls(bodies[1]!)).toEqual([{ name: "lookup_weather", signature: mockThoughtSignature("call_weather") }]);
    expect(lastText(state)).toBe("It is 21 degrees in Paris.");
  });

  it("carries the signature across an approval pause: checkpointed, resumed, still signed", async () => {
    mock.enqueue(anthropicToolUse("call_paused", "lookup_weather", { city: "Oslo" })).enqueue(anthropicText("It is 21 degrees in Oslo."));
    const checkpointer = new MemorySaver();
    const agent = createAgent({
      model: await gemini(),
      tools: [lookup],
      middleware: [humanInTheLoopMiddleware({ interruptOn: { lookup_weather: true } })],
      checkpointer,
    });
    const config = { configurable: { thread_id: "thread-approval" } };

    await agent.invoke({ messages: [new HumanMessage("What is the weather in Oslo?")] }, config);
    const paused = await agent.graph.getState(config);
    expect(paused.tasks.some((task) => task.interrupts.length > 0), "the turn waits for approval").toBe(true);
    expect(loopBodies()).toHaveLength(1);

    const done = await agent.invoke(new Command({ resume: { decisions: [{ type: "approve" }] } }), config);

    const bodies = loopBodies();
    expect(bodies).toHaveLength(2);
    expect(sentCalls(bodies[1]!)).toEqual([{ name: "lookup_weather", signature: mockThoughtSignature("call_paused") }]);
    expect(lastText(done)).toBe("It is 21 degrees in Oslo.");
  });

  it("answers structured output by function calling with thinking on", async () => {
    mock.enqueue(withThinking(anthropicToolUse("call_extract", "verdict", { approved: true, reason: "ok" })));
    const model = await gemini({ thinking: { mode: ThinkingMode.ENABLED, profile: { shape: "budget", required: undefined } } });
    const extract = model.withStructuredOutput(z.object({ approved: z.boolean(), reason: z.string() }), { method: "functionCalling", name: "verdict" });

    const result = await extract.invoke("Approve this.");

    expect(result).toEqual({ approved: true, reason: "ok" });
    const [body] = loopBodies();
    expect(body?.tools?.[0]?.functionDeclarations?.map((declaration) => declaration.name)).toEqual(["verdict"]);
    expect(body?.generationConfig?.thinkingConfig).toMatchObject({ includeThoughts: true });
  });

  it("sends a data-URL image as inline data", async () => {
    mock.enqueue(anthropicText("A red square."));
    const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

    const reply = await (await gemini()).invoke([
      new HumanMessage({ content: [{ type: "text", text: "What is this?" }, { type: "image_url", image_url: { url: `data:image/png;base64,${pixel}` } }] }),
    ]);

    expect(reply.text).toBe("A red square.");
    const parts = loopBodies()[0]?.contents.at(-1)?.parts ?? [];
    expect(parts.find((part) => part.inlineData !== undefined)?.inlineData).toEqual({ mimeType: "image/png", data: pixel });
  });

  it("reports usage on message-finish, thinking counted as output", async () => {
    const usage = { inputTokens: 40, outputTokens: 9, cacheReadInputTokens: 30 };
    mock.enqueue(withThinking(anthropicToolUse("call_usage", "lookup_weather", { city: "Rome" }, usage))).enqueue(anthropicText("Warm.", usage));
    const agent = createAgent({ model: await gemini(), tools: [lookup] });

    const events = await streamAll((await agent.streamEvents({ messages: [new HumanMessage("Weather in Rome?")] }, { version: "v3" })) as AsyncIterable<unknown>);

    const finishes = events.map(usageOf).filter((one): one is V3UsagePayload => one !== undefined);
    expect(finishes).toHaveLength(2);
    expect(finishes[0]).toMatchObject({ input_tokens: 70, output_tokens: 9 + MOCK_THOUGHT_TOKENS_PER_BLOCK });
    expect(finishes[1]).toMatchObject({ input_tokens: 70, output_tokens: 9 });
    // The client's event stream reports no cached input: the 30 cached tokens
    // are counted in the input, at the input rate (`model-client.ts`).
    expect(finishes[0]?.input_token_details?.cache_read).toBeUndefined();
  });

  it("raises a refused key with its status and Google's reason", async () => {
    mock.enqueueError(400, { body: geminiError(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key.", "API_KEY_INVALID") });

    const failure = await (await gemini()).invoke("Hello").then(
      () => undefined,
      (err: unknown) => err as { statusCode?: unknown; data?: unknown },
    );

    expect(failure?.statusCode).toBe(400);
    expect(JSON.stringify(failure?.data)).toContain("API_KEY_INVALID");
  });

  it("retries a 503 before the reply begins, on the path the agent loop streams through", async () => {
    mock.enqueueError(503, { body: geminiError(503, "UNAVAILABLE", "The model is overloaded.") }).enqueue(anthropicText("Recovered."));
    const agent = createAgent({ model: await gemini(), tools: [lookup] });

    const run = await agent.streamEvents({ messages: [new HumanMessage("Hello")] }, { version: "v3" });
    await streamAll(run as AsyncIterable<unknown>);
    const state = await (run as { output: Promise<{ messages: BaseMessage[] }> }).output;

    expect(mock.consumed(), mock.describeTraffic()).toBe(2);
    expect(lastText(state)).toBe("Recovered.");
  });

  it("sends the run credential as a bearer to a Stigmer endpoint, never a Google key", async () => {
    mock.enqueue(anthropicText("Hi."));

    await (await gemini()).invoke("Hello");

    const [request] = mock.scriptedRequests();
    expect(request?.path).toBe("/v1/proxy/llm/google/v1beta/models/gemini-3-flash:generateContent");
    expect(request?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(request?.headers["x-stigmer-execution-id"]).toBe(executionId);
    expect(request?.headers["x-goog-api-key"]).toBeUndefined();
  });
});
