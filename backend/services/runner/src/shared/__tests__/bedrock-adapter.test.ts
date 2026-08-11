/**
 * Adapter test for the bedrock backend branch of buildChatModel — the
 * complement of bedrock-seam.test.ts, mirroring vertex-adapter.test.ts.
 *
 * The seam test pins the REAL AnthropicBedrock client's wire behavior under
 * a hand-built ChatAnthropic. This file pins OUR production wiring: a real
 * `buildChatModel` and a real `ChatAnthropic` drive a mocked
 * `@anthropic-ai/bedrock-sdk`, so LangChain's lazy `createClient` invocation
 * path (client constructed on first request, once per cached client) is
 * exercised exactly as production does it. Together the two files cover the
 * whole chain without any test-only injection seam in production code.
 *
 * Pinned here:
 * - the factory forwards LangChain's `maxRetries: 0` to the client (a
 *   factory that drops it nests SDK retries inside LangChain's own loop),
 * - the factory forwards the request timeout (clientOptions.timeout ->
 *   factory options -> SDK constructor; how STIGMER_LLM_REQUEST_TIMEOUT_MS
 *   bounds this backend),
 * - construction and invocation succeed with NO ANTHROPIC_API_KEY (Bedrock
 *   auth is AWS's, and ChatAnthropic waives the key when createClient is
 *   provided),
 * - the translated `anthropic.…-v1:0` id (with the deployment's inference
 *   prefix and map overrides applied) crosses the wire while the returned
 *   apiModelId stays canonical (the canonical-id invariant),
 * - the maxTokens landmine: Bedrock ids miss LangChain's per-model default
 *   table, so the adapter must inject the CANONICAL id's default,
 * - usage_metadata survives the adapter (what billing reads).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

const { bedrockCtorArgs, createRequests } = vi.hoisted(() => ({
  bedrockCtorArgs: [] as Array<{ maxRetries?: number; timeout?: number }>,
  createRequests: [] as Array<Record<string, unknown>>,
}));

vi.mock("@anthropic-ai/bedrock-sdk", () => ({
  AnthropicBedrock: class {
    readonly maxRetries: number | undefined;
    readonly messages = {
      create: async (request: Record<string, unknown>) => {
        createRequests.push(request);
        return {
          id: "msg_bedrock_adapter_01",
          type: "message",
          role: "assistant",
          model: request.model,
          content: [{ type: "text", text: "Namaste from Bedrock." }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 7, output_tokens: 5 },
        };
      },
    };

    constructor(opts: { maxRetries?: number; timeout?: number }) {
      bedrockCtorArgs.push(opts);
      this.maxRetries = opts.maxRetries;
    }
  },
}));

import { ChatAnthropic } from "@langchain/anthropic";

import { buildChatModel } from "../model-client.js";
import { _resetRegistryCache } from "../model-registry.js";

describe("buildChatModel bedrock adapter", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    _resetRegistryCache();
    bedrockCtorArgs.length = 0;
    createRequests.length = 0;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.STIGMER_BEDROCK_MODEL_MAP;
    delete process.env.STIGMER_BEDROCK_INFERENCE_PREFIX;
    process.env.STIGMER_ANTHROPIC_BACKEND = "bedrock";
    process.env.AWS_REGION = "ap-south-1";
    // Registry offline → resolveToApiModelId passes the id through, keeping
    // this test free of registry fixtures (that path has its own tests).
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("registry offline"));
  });

  afterEach(() => {
    _resetRegistryCache();
    vi.restoreAllMocks();
    process.env = { ...savedEnv };
  });

  it("drives the mocked client through the real createClient path with the invariants intact", async () => {
    const { model, apiModelId } = await buildChatModel({
      modelName: "claude-sonnet-4-5-20250929",
      maxTokens: 1024,
    });

    // Canonical id returned; the client is not constructed yet (lazy factory).
    expect(apiModelId).toBe("claude-sonnet-4-5-20250929");
    expect(bedrockCtorArgs).toHaveLength(0);

    const result = await model.invoke([new HumanMessage("Weather in Chennai?")]);

    // First request constructed exactly one (batch) client, with LangChain's
    // maxRetries: 0 honored — LangChain owns retrying.
    expect(bedrockCtorArgs).toHaveLength(1);
    expect(bedrockCtorArgs[0].maxRetries).toBe(0);

    // The wire carries the Bedrock-translated id; billing already got the
    // canonical one above.
    expect(createRequests).toHaveLength(1);
    expect(createRequests[0].model).toBe("anthropic.claude-sonnet-4-5-20250929-v1:0");
    expect(createRequests[0].max_tokens).toBe(1024);

    // Response and usage flow back through LangChain untouched.
    expect(result).toBeInstanceOf(AIMessage);
    expect(result.text).toBe("Namaste from Bedrock.");
    expect((result as AIMessage).usage_metadata).toMatchObject({
      input_tokens: 7,
      output_tokens: 5,
      total_tokens: 12,
    });
  });

  it("applies the deployment's inference prefix to the wire id, canonical id untouched", async () => {
    process.env.STIGMER_BEDROCK_INFERENCE_PREFIX = "us";

    const { model, apiModelId } = await buildChatModel({
      modelName: "claude-sonnet-4-6",
      maxTokens: 256,
    });
    await model.invoke([new HumanMessage("hi")]);

    expect(apiModelId).toBe("claude-sonnet-4-6");
    expect(createRequests.at(-1)?.model).toBe("us.anthropic.claude-sonnet-4-6-v1:0");
  });

  it("honors a model-map override over prefix and rule", async () => {
    process.env.STIGMER_BEDROCK_MODEL_MAP =
      "claude-sonnet-4-6=eu.anthropic.claude-sonnet-4-6-custom-v2:0";
    process.env.STIGMER_BEDROCK_INFERENCE_PREFIX = "us";

    const { model } = await buildChatModel({
      modelName: "claude-sonnet-4-6",
      maxTokens: 256,
    });
    await model.invoke([new HumanMessage("hi")]);

    expect(createRequests.at(-1)?.model).toBe("eu.anthropic.claude-sonnet-4-6-custom-v2:0");
  });

  it("injects the CANONICAL id's default maxTokens when the caller omits it (the 4096 landmine)", async () => {
    // LangChain's per-model default table prefix-matches the model string.
    // `anthropic.…` ids match nothing and silently fall back to 4096 —
    // setup.ts omits maxTokens, so every deep-agent call would be capped.
    // The adapter must inject what the canonical id would have received on
    // the public API or vertex, whatever that is at the installed LangChain
    // version (16384 for 4.5/4.6-generation ids at 1.4.0).
    const canonicalDefault = new ChatAnthropic({
      model: "claude-sonnet-4-5-20250929",
      apiKey: "probe",
    }).maxTokens;
    const bedrockFallback = new ChatAnthropic({
      model: "anthropic.claude-sonnet-4-5-20250929-v1:0",
      apiKey: "probe",
    }).maxTokens;
    // The landmine this guards against: if these ever agree, the injection
    // is redundant (but still correct) — the pin below is what matters.
    expect(bedrockFallback).not.toBe(canonicalDefault);

    const { model } = await buildChatModel({ modelName: "claude-sonnet-4-5-20250929" });
    await model.invoke([new HumanMessage("hi")]);

    expect(createRequests.at(-1)?.max_tokens).toBe(canonicalDefault);
  });

  it("forwards the request timeout to the SDK client (STIGMER_LLM_REQUEST_TIMEOUT_MS path)", async () => {
    // The timeout rides clientOptions -> factory options -> SDK constructor.
    // A factory that drops it silently unbounds the operator's timeout on
    // this backend (the regression T06 repaired for the public path).
    const { model } = await buildChatModel({
      modelName: "claude-sonnet-4-6",
      maxTokens: 256,
      timeoutMs: 5000,
    });
    await model.invoke([new HumanMessage("hi")]);

    expect(bedrockCtorArgs).toHaveLength(1);
    expect(bedrockCtorArgs[0].timeout).toBe(5000);
    expect(bedrockCtorArgs[0].maxRetries).toBe(0);
  });

  it("constructs and invokes with no ANTHROPIC_API_KEY anywhere in the environment", async () => {
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();

    const { model } = await buildChatModel({
      modelName: "claude-sonnet-4-6",
      maxTokens: 256,
    });
    const result = await model.invoke([new HumanMessage("hi")]);

    expect(result).toBeInstanceOf(AIMessage);
    expect(createRequests.at(-1)?.model).toBe("anthropic.claude-sonnet-4-6-v1:0");
  });

  it("fails at dispatch with the catalog message when AWS_REGION is missing", async () => {
    delete process.env.AWS_REGION;

    await expect(
      buildChatModel({ modelName: "claude-sonnet-4-6", maxTokens: 256 }),
    ).rejects.toThrow(/AWS_REGION/);
  });
});
