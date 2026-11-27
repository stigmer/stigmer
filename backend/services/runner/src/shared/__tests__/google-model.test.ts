/**
 * `buildChatModel`'s Google arm, read off the model it builds: where its
 * requests go, the credential its transport adds, its thinking, its tier,
 * its retries and its name. No request leaves the process: the transport's
 * `fetch` is called with a stubbed global `fetch`, the way the client
 * would call it.
 *
 * The wire itself (signatures, streaming, usage, errors) is
 * `google-client.test.ts`'s, against the conformance mock.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HumanMessage } from "@langchain/core/messages";
import { ServiceTier, ThinkingMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import { buildChatModel } from "../model-client.js";
import { GEMINI_API_ENDPOINT, GEMINI_API_VERSION, type GoogleApiClient } from "../google-transport.js";
import { MODEL_REQUEST_RETRIES, modelRequestFailed } from "../model-retry.js";
import { _resetRegistryCache } from "../model-registry.js";
import { resetModelLanesForTests, routeModelCallsThroughLanes } from "../model-lanes.js";
import { resetRunnerSecretsForTests, setRunnerSecret } from "../runner-credential-store.js";
import { GOOGLE_DYNAMIC_THINKING_BUDGET } from "../thinking-mode.js";
import { stubRegistryFetch } from "../../__test-utils__/model-registry-fixture.js";

/** What the client reads off a `ChatGoogle`. */
interface GoogleFields {
  readonly model: string;
  readonly modelName: string;
  readonly endpoint: string;
  readonly apiVersion: string;
  readonly platform: string;
  readonly apiClient: GoogleApiClient;
  readonly params: Record<string, unknown>;
  getName(): string;
}

let registry: ReturnType<typeof stubRegistryFetch>;

beforeEach(() => {
  _resetRegistryCache();
  resetRunnerSecretsForTests();
  registry = stubRegistryFetch({ live: true });
});

afterEach(() => {
  registry.restore();
  resetModelLanesForTests();
  resetRunnerSecretsForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function google(options: Partial<Parameters<typeof buildChatModel>[0]> = {}): Promise<GoogleFields> {
  const built = await buildChatModel({ modelName: "google:gemini-3-flash", ...options });
  expect(built.provider).toBe("google");
  expect(built.apiModelId).toBe("gemini-3-flash");
  return built.model as unknown as GoogleFields;
}

/** The headers the model's transport sends on one request, through a stubbed `fetch`. */
async function sentHeaders(model: GoogleFields): Promise<Headers> {
  let seen: Headers | undefined;
  vi.stubGlobal("fetch", async (request: Request) => {
    seen = request.headers;
    return new Response("{}", { status: 200 });
  });
  await model.apiClient.fetch(new Request(`${model.endpoint}/${model.apiVersion}/models/${model.model}:generateContent`, { method: "POST", body: "{}" }));
  if (seen === undefined) throw new Error("the transport sent nothing");
  return seen;
}

describe("buildChatModel for a Google model", () => {
  it("calls Google's Gemini API directly with the operator's key in x-goog-api-key", async () => {
    setRunnerSecret("GEMINI_API_KEY", "operator-gemini-key");
    vi.stubEnv("GOOGLE_API_KEY", "a-persons-own-google-key");

    const model = await google();

    expect(model.endpoint).toBe(GEMINI_API_ENDPOINT);
    expect(model.apiVersion).toBe(GEMINI_API_VERSION);
    expect(model.platform).toBe("gai");
    expect(model.params.apiKey, "the instance never reads GOOGLE_API_KEY").toBe("");
    const headers = await sentHeaders(model);
    expect(headers.get("x-goog-api-key")).toBe("operator-gemini-key");
    expect(headers.get("authorization")).toBeNull();
  });

  it("calls the platform proxy's Google path with the run credential as a bearer", async () => {
    const model = await google({ proxyEndpoint: "https://api.example.test/", stigmerToken: "run-token", headerScope: { executionId: "run_1" } });

    expect(model.endpoint).toBe("https://api.example.test/v1/proxy/llm/google");
    const headers = await sentHeaders(model);
    expect(headers.get("authorization")).toBe("Bearer run-token");
    expect(headers.get("x-stigmer-execution-id")).toBe("run_1");
    expect(headers.get("x-goog-api-key")).toBeNull();
  });

  it("in the agent host, calls the local proxy's Google lane with the host's token", async () => {
    routeModelCallsThroughLanes("http://127.0.0.1:4100", "host-token");

    const model = await google({ headerScope: { executionId: "run_2" } });

    expect(model.endpoint).toBe("http://127.0.0.1:4100/v1/proxy/llm/google");
    const headers = await sentHeaders(model);
    expect(headers.get("authorization")).toBe("Bearer host-token");
    expect(headers.get("x-goog-api-key")).toBeNull();
  });

  it("maps the row's thinking form to the client's budget", async () => {
    const adaptive = await google({ thinking: { mode: ThinkingMode.ENABLED, profile: { shape: "adaptive", required: undefined } } });
    const budget = await google({ thinking: { mode: ThinkingMode.ENABLED, profile: { shape: "budget", required: undefined } } });
    const off = await google({ thinking: { mode: ThinkingMode.DISABLED, profile: { shape: "adaptive", required: false } } });
    const none = await google({ thinking: { mode: ThinkingMode.ENABLED, profile: undefined } });

    expect(adaptive.params.thinkingBudget).toBe(GOOGLE_DYNAMIC_THINKING_BUDGET);
    expect(budget.params.thinkingBudget).toBe(16_000);
    expect(off.params.thinkingBudget).toBe(0);
    expect(none.params).not.toHaveProperty("thinkingBudget");
  });

  it("refuses the fast tier rather than serving it at the standard rate, and sends no tier otherwise", async () => {
    await expect(google({ serviceTier: ServiceTier.FAST })).rejects.toThrow(/Google models are served on the standard tier only/);

    const standard = await google({ serviceTier: ServiceTier.STANDARD });
    expect(standard.params).not.toHaveProperty("serviceTier");
  });

  it("carries the runner's retry rule, the library's name, and its provider:model name", async () => {
    const model = await google({ temperature: null, maxTokens: 8192, streaming: true });

    expect(model.params).toMatchObject({ maxRetries: MODEL_REQUEST_RETRIES, onFailedAttempt: modelRequestFailed, maxOutputTokens: 8192, streaming: true });
    expect(model.params).not.toHaveProperty("temperature");
    expect(model.getName()).toBe("ChatGoogle");
    expect(model.modelName).toBe("google:gemini-3-flash");
  });

  it("a stream that ends before its first event yields nothing", async () => {
    setRunnerSecret("GEMINI_API_KEY", "k");
    const model = (await buildChatModel({ modelName: "google:gemini-3-flash" })).model;
    vi.stubGlobal("fetch", async () => new Response(null, { status: 200 }));

    const events: unknown[] = [];
    for await (const event of model._streamChatModelEvents([new HumanMessage("Hello")], {})) events.push(event);

    expect(events).toEqual([]);
  });

  it("never passes streaming: false, which would turn the client's streamed path off", async () => {
    const model = await google();

    expect(model.params).not.toHaveProperty("streaming");
  });
});
