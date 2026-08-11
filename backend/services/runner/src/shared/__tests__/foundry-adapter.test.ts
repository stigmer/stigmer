/**
 * Adapter test for the foundry backend branch of buildChatModel — the
 * complement of foundry-seam.test.ts, mirroring vertex-adapter.test.ts and
 * bedrock-adapter.test.ts.
 *
 * The seam test pins the REAL AnthropicFoundry client's wire behavior under
 * a hand-built ChatAnthropic. This file pins OUR production wiring: a real
 * `buildChatModel` and a real `ChatAnthropic` drive a mocked
 * `@anthropic-ai/foundry-sdk` (and a mocked `@azure/identity`), so
 * LangChain's lazy `createClient` invocation path is exercised exactly as
 * production does it. Together the two files cover the whole chain without
 * any test-only injection seam in production code.
 *
 * Pinned here:
 * - the factory forwards LangChain's `maxRetries: 0` to the client,
 * - construction and invocation succeed with NO ANTHROPIC_API_KEY (Foundry
 *   auth is Azure's, and ChatAnthropic waives the key when createClient is
 *   provided),
 * - the deployment name (strip-date rule, map overrides applied) crosses
 *   the wire while the returned apiModelId stays canonical (the
 *   canonical-id invariant),
 * - auth selection: ANTHROPIC_FOUNDRY_API_KEY present -> no token provider
 *   and @azure/identity never touched; absent -> the Entra chain provider
 *   built with the Foundry scope and handed to the client,
 * - maxTokens parity: stripping the date preserves LangChain's per-model
 *   default, so the adapter needs NO injection (unlike bedrock's 4096
 *   landmine) — pinned so a LangChain bump that diverges the two forms
 *   fails here instead of silently capping Foundry deployments,
 * - usage_metadata survives the adapter (what billing reads).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

const { foundryCtorArgs, createRequests, identityCalls } = vi.hoisted(() => ({
  foundryCtorArgs: [] as Array<{
    maxRetries?: number;
    azureADTokenProvider?: () => Promise<string>;
  }>,
  createRequests: [] as Array<Record<string, unknown>>,
  identityCalls: {
    credentialConstructions: 0,
    tokenProviderScopes: [] as string[],
  },
}));

vi.mock("@anthropic-ai/foundry-sdk", () => ({
  AnthropicFoundry: class {
    readonly maxRetries: number | undefined;
    readonly messages = {
      create: async (request: Record<string, unknown>) => {
        createRequests.push(request);
        return {
          id: "msg_foundry_adapter_01",
          type: "message",
          role: "assistant",
          model: request.model,
          content: [{ type: "text", text: "Namaste from Foundry." }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 7, output_tokens: 5 },
        };
      },
    };

    constructor(opts: {
      maxRetries?: number;
      azureADTokenProvider?: () => Promise<string>;
    }) {
      foundryCtorArgs.push(opts);
      this.maxRetries = opts.maxRetries;
    }
  },
}));

vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: class {
    constructor() {
      identityCalls.credentialConstructions += 1;
    }
  },
  getBearerTokenProvider: (_credential: unknown, scope: string) => {
    identityCalls.tokenProviderScopes.push(scope);
    return async () => "entra-adapter-token";
  },
}));

import { ChatAnthropic } from "@langchain/anthropic";

import { buildChatModel } from "../model-client.js";
import { _resetRegistryCache } from "../model-registry.js";

describe("buildChatModel foundry adapter", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    _resetRegistryCache();
    foundryCtorArgs.length = 0;
    createRequests.length = 0;
    identityCalls.credentialConstructions = 0;
    identityCalls.tokenProviderScopes.length = 0;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_FOUNDRY_BASE_URL;
    delete process.env.STIGMER_FOUNDRY_DEPLOYMENT_MAP;
    process.env.STIGMER_ANTHROPIC_BACKEND = "foundry";
    process.env.ANTHROPIC_FOUNDRY_RESOURCE = "adapter-test-resource";
    process.env.ANTHROPIC_FOUNDRY_API_KEY = "foundry-adapter-test-key";
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
    expect(foundryCtorArgs).toHaveLength(0);

    const result = await model.invoke([new HumanMessage("Weather in Chennai?")]);

    // First request constructed exactly one (batch) client, with LangChain's
    // maxRetries: 0 honored — LangChain owns retrying.
    expect(foundryCtorArgs).toHaveLength(1);
    expect(foundryCtorArgs[0].maxRetries).toBe(0);

    // The wire carries the deployment name (date stripped); billing already
    // got the canonical id above.
    expect(createRequests).toHaveLength(1);
    expect(createRequests[0].model).toBe("claude-sonnet-4-5");
    expect(createRequests[0].max_tokens).toBe(1024);

    // Response and usage flow back through LangChain untouched.
    expect(result).toBeInstanceOf(AIMessage);
    expect(result.text).toBe("Namaste from Foundry.");
    expect((result as AIMessage).usage_metadata).toMatchObject({
      input_tokens: 7,
      output_tokens: 5,
      total_tokens: 12,
    });
  });

  it("honors a deployment-map override over the strip-date rule", async () => {
    process.env.STIGMER_FOUNDRY_DEPLOYMENT_MAP =
      "claude-sonnet-4-6=my-sonnet-deployment";

    const { model, apiModelId } = await buildChatModel({
      modelName: "claude-sonnet-4-6",
      maxTokens: 256,
    });
    await model.invoke([new HumanMessage("hi")]);

    expect(apiModelId).toBe("claude-sonnet-4-6");
    expect(createRequests.at(-1)?.model).toBe("my-sonnet-deployment");
  });

  it("uses API-key auth when ANTHROPIC_FOUNDRY_API_KEY is set — @azure/identity untouched", async () => {
    const { model } = await buildChatModel({
      modelName: "claude-sonnet-4-6",
      maxTokens: 256,
    });
    await model.invoke([new HumanMessage("hi")]);

    // The SDK reads the key from its own env var; the adapter must not
    // pass a token provider alongside it (the constructor treats them as
    // mutually exclusive) and must not touch the Azure credential chain.
    expect(foundryCtorArgs.at(-1)?.azureADTokenProvider).toBeUndefined();
    expect(identityCalls.credentialConstructions).toBe(0);
    expect(identityCalls.tokenProviderScopes).toHaveLength(0);
  });

  it("falls back to the Entra chain with the Foundry scope when no key is set", async () => {
    delete process.env.ANTHROPIC_FOUNDRY_API_KEY;

    const { model } = await buildChatModel({
      modelName: "claude-sonnet-4-6",
      maxTokens: 256,
    });
    await model.invoke([new HumanMessage("hi")]);

    // One DefaultAzureCredential, one provider with the ai.azure.com scope,
    // handed to the client so every request authenticates as Bearer.
    expect(identityCalls.credentialConstructions).toBe(1);
    expect(identityCalls.tokenProviderScopes).toEqual(["https://ai.azure.com/.default"]);
    const provider = foundryCtorArgs.at(-1)?.azureADTokenProvider;
    expect(provider).toBeTypeOf("function");
    await expect(provider!()).resolves.toBe("entra-adapter-token");
  });

  it("treats a whitespace-only key as absent (Entra, not a blank x-api-key)", async () => {
    process.env.ANTHROPIC_FOUNDRY_API_KEY = "   ";

    const { model } = await buildChatModel({
      modelName: "claude-sonnet-4-6",
      maxTokens: 256,
    });
    await model.invoke([new HumanMessage("hi")]);

    expect(foundryCtorArgs.at(-1)?.azureADTokenProvider).toBeTypeOf("function");
  });

  it("needs no maxTokens injection: the deployment name inherits the canonical default", async () => {
    // The vertex-style parity pin (contrast with bedrock's 4096 landmine):
    // LangChain's per-model default table prefix-matches the model string,
    // and a date-stripped id is a prefix of its own canonical form, so both
    // resolve identically — probed 2026-08-11 across the full catalog. If a
    // LangChain bump ever adds date-qualified table entries that diverge
    // the two forms, this fails and the adapter needs bedrock's
    // canonical-probe injection.
    const canonicalDefault = new ChatAnthropic({
      model: "claude-sonnet-4-5-20250929",
      apiKey: "probe",
    }).maxTokens;
    const deploymentDefault = new ChatAnthropic({
      model: "claude-sonnet-4-5",
      apiKey: "probe",
    }).maxTokens;
    expect(deploymentDefault).toBe(canonicalDefault);

    const { model } = await buildChatModel({ modelName: "claude-sonnet-4-5-20250929" });
    await model.invoke([new HumanMessage("hi")]);

    expect(createRequests.at(-1)?.max_tokens).toBe(canonicalDefault);
  });

  it("constructs and invokes with no ANTHROPIC_API_KEY anywhere in the environment", async () => {
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();

    const { model } = await buildChatModel({
      modelName: "claude-sonnet-4-6",
      maxTokens: 256,
    });
    const result = await model.invoke([new HumanMessage("hi")]);

    expect(result).toBeInstanceOf(AIMessage);
    expect(createRequests.at(-1)?.model).toBe("claude-sonnet-4-6");
  });

  it("fails at dispatch with the catalog message when no endpoint is configured", async () => {
    delete process.env.ANTHROPIC_FOUNDRY_RESOURCE;

    await expect(
      buildChatModel({ modelName: "claude-sonnet-4-6", maxTokens: 256 }),
    ).rejects.toThrow(/ANTHROPIC_FOUNDRY_RESOURCE/);
  });
});
