/**
 * Adapter test for the vertex backend branch of buildChatModel — the
 * complement of vertex-seam.test.ts.
 *
 * The seam test pins the REAL AnthropicVertex client's wire behavior under
 * a hand-built ChatAnthropic. This file pins OUR production wiring: a real
 * `buildChatModel` and a real `ChatAnthropic` drive a mocked
 * `@anthropic-ai/vertex-sdk`, so LangChain's lazy `createClient` invocation
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
 * - construction and invocation succeed with NO ANTHROPIC_API_KEY (Vertex
 *   auth is Google's, and ChatAnthropic waives the key when createClient
 *   is provided),
 * - the translated `@date` id is what crosses the wire while the returned
 *   apiModelId stays canonical (the canonical-id invariant),
 * - usage_metadata survives the adapter (what billing reads).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

const { vertexCtorArgs, createRequests } = vi.hoisted(() => ({
  vertexCtorArgs: [] as Array<{ maxRetries?: number; timeout?: number }>,
  createRequests: [] as Array<Record<string, unknown>>,
}));

vi.mock("@anthropic-ai/vertex-sdk", () => ({
  AnthropicVertex: class {
    readonly maxRetries: number | undefined;
    readonly messages = {
      create: async (request: Record<string, unknown>) => {
        createRequests.push(request);
        return {
          id: "msg_vertex_adapter_01",
          type: "message",
          role: "assistant",
          model: request.model,
          content: [{ type: "text", text: "Namaste from Vertex." }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 7, output_tokens: 5 },
        };
      },
    };

    constructor(opts: { maxRetries?: number; timeout?: number }) {
      vertexCtorArgs.push(opts);
      this.maxRetries = opts.maxRetries;
    }
  },
}));

import { ChatAnthropic } from "@langchain/anthropic";

import { buildChatModel } from "../model-client.js";
import { _resetRegistryCache } from "../model-registry.js";
import { toVertexModelId } from "../llm-backend.js";

describe("buildChatModel vertex adapter", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    _resetRegistryCache();
    vertexCtorArgs.length = 0;
    createRequests.length = 0;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.STIGMER_ANTHROPIC_BACKEND = "vertex";
    process.env.CLOUD_ML_REGION = "asia-south1";
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
    expect(vertexCtorArgs).toHaveLength(0);

    const result = await model.invoke([new HumanMessage("Weather in Chennai?")]);

    // First request constructed exactly one (batch) client, with LangChain's
    // maxRetries: 0 honored — LangChain owns retrying.
    expect(vertexCtorArgs).toHaveLength(1);
    expect(vertexCtorArgs[0].maxRetries).toBe(0);

    // The wire carries the Vertex-translated id; billing already got the
    // canonical one above.
    expect(createRequests).toHaveLength(1);
    expect(createRequests[0].model).toBe("claude-sonnet-4-5@20250929");
    expect(createRequests[0].max_tokens).toBe(1024);

    // Response and usage flow back through LangChain untouched.
    expect(result).toBeInstanceOf(AIMessage);
    expect(result.text).toBe("Namaste from Vertex.");
    expect((result as AIMessage).usage_metadata).toMatchObject({
      input_tokens: 7,
      output_tokens: 5,
      total_tokens: 12,
    });
  });

  it("translated ids inherit the same default maxTokens as canonical ids", () => {
    // setup.ts deliberately omits maxTokens, so the LangChain per-model
    // default applies. That default prefix-matches the model string — and the
    // vertex branch hands ChatAnthropic the TRANSLATED string. This pins the
    // equality the zero-behavior-change criterion rests on (verified 16384 ==
    // 16384 for 4.5-generation ids at @langchain/anthropic 1.4.0); a future
    // bump that diverges the two forms fails here instead of silently capping
    // vertex deployments differently from public ones.
    for (const canonical of [
      "claude-sonnet-4-5-20250929",
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-6",
    ]) {
      const publicModel = new ChatAnthropic({ model: canonical, apiKey: "probe" });
      const vertexModel = new ChatAnthropic({ model: toVertexModelId(canonical), apiKey: "probe" });
      expect(vertexModel.maxTokens, canonical).toBe(publicModel.maxTokens);
    }
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

    expect(vertexCtorArgs).toHaveLength(1);
    expect(vertexCtorArgs[0].timeout).toBe(5000);
    expect(vertexCtorArgs[0].maxRetries).toBe(0);
  });

  it("constructs and invokes with no ANTHROPIC_API_KEY anywhere in the environment", async () => {
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();

    const { model } = await buildChatModel({
      modelName: "claude-sonnet-4-6",
      maxTokens: 256,
    });
    const result = await model.invoke([new HumanMessage("hi")]);

    expect(result).toBeInstanceOf(AIMessage);
    // Dateless 4.6-generation id crossed the wire untranslated.
    expect(createRequests.at(-1)?.model).toBe("claude-sonnet-4-6");
  });
});
