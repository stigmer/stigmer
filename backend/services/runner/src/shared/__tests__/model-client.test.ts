import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Capture constructor args without pulling in the real SDKs. vi.hoisted lets the
// hoisted vi.mock factories reference these spies safely.
const { mockAnthropicCtor, mockOpenAICtor } = vi.hoisted(() => ({
  mockAnthropicCtor: vi.fn(),
  mockOpenAICtor: vi.fn(),
}));

vi.mock("@langchain/anthropic", () => ({
  ChatAnthropic: vi.fn((args: unknown) => {
    mockAnthropicCtor(args);
    return { provider: "anthropic", args };
  }),
}));

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: vi.fn((args: unknown) => {
    mockOpenAICtor(args);
    return { provider: "openai", args };
  }),
}));

import { buildChatModel } from "../model-client.js";
import { _resetRegistryCache } from "../model-registry.js";

interface MockModel {
  id: string;
  apiModelId?: string;
  provider: string;
  costTier?: string;
  harness?: string;
}

function mockRegistryResponse(models: MockModel[]) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ models }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function lastAnthropicArgs(): Record<string, unknown> {
  return mockAnthropicCtor.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

describe("buildChatModel", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    _resetRegistryCache();
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.STIGMER_ANTHROPIC_BACKEND;
    delete process.env.STIGMER_OPENAI_BACKEND;
    delete process.env.CLOUD_ML_REGION;
  });

  afterEach(() => {
    _resetRegistryCache();
    vi.restoreAllMocks();
    process.env = { ...savedEnv };
  });

  it("resolves a registry id to the provider apiModelId before construction", async () => {
    mockRegistryResponse([
      { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", provider: "anthropic" },
    ]);

    const { provider, apiModelId } = await buildChatModel({ modelName: "claude-haiku-4.5" });

    expect(provider).toBe("anthropic");
    expect(apiModelId).toBe("claude-haiku-4-5-20251001");
    expect(lastAnthropicArgs()).toMatchObject({ model: "claude-haiku-4-5-20251001" });
  });

  it("infers the OpenAI provider and routes to ChatOpenAI", async () => {
    mockRegistryResponse([
      { id: "gpt-4.1", apiModelId: "gpt-4.1", provider: "openai" },
    ]);

    const { provider } = await buildChatModel({ modelName: "gpt-4.1" });

    expect(provider).toBe("openai");
    expect(mockOpenAICtor).toHaveBeenCalledTimes(1);
    expect(mockAnthropicCtor).not.toHaveBeenCalled();
  });

  it("wires the Anthropic proxy base URL, headers, and token in proxy mode", async () => {
    mockRegistryResponse([
      { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", provider: "anthropic" },
    ]);

    await buildChatModel({
      modelName: "claude-haiku-4.5",
      proxyEndpoint: "https://api.stigmer.ai",
      stigmerToken: "tok-123",
      headerScope: { executionId: "ex-1" },
    });

    expect(lastAnthropicArgs()).toMatchObject({
      apiKey: "tok-123",
      clientOptions: {
        baseURL: "https://api.stigmer.ai/v1/proxy/llm/anthropic",
        defaultHeaders: {
          Authorization: "Bearer tok-123",
          "X-Stigmer-Execution-Id": "ex-1",
        },
      },
    });
  });

  it("wires the OpenAI proxy path under `configuration` (not `clientOptions`)", async () => {
    mockRegistryResponse([
      { id: "gpt-4.1", apiModelId: "gpt-4.1", provider: "openai" },
    ]);

    await buildChatModel({
      modelName: "gpt-4.1",
      proxyEndpoint: "https://api.stigmer.ai",
      stigmerToken: "tok",
    });

    const args = mockOpenAICtor.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(args).toMatchObject({
      configuration: { baseURL: "https://api.stigmer.ai/v1/proxy/llm/openai/v1" },
    });
  });

  it("uses the provider env var key in direct mode (no proxy)", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-direct";
    mockRegistryResponse([
      { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", provider: "anthropic" },
    ]);

    await buildChatModel({ modelName: "claude-haiku-4.5" });

    const args = lastAnthropicArgs();
    expect(args.apiKey).toBe("sk-direct");
    expect(args).not.toHaveProperty("clientOptions");
  });

  it("omits maxTokens unless explicitly provided", async () => {
    mockRegistryResponse([
      { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", provider: "anthropic" },
    ]);

    await buildChatModel({ modelName: "claude-haiku-4.5" });
    expect(lastAnthropicArgs()).not.toHaveProperty("maxTokens");

    await buildChatModel({ modelName: "claude-haiku-4.5", maxTokens: 4096 });
    expect(lastAnthropicArgs()).toMatchObject({ maxTokens: 4096 });
  });

  it("passes the model id through unchanged when the registry is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"));

    const { provider, apiModelId } = await buildChatModel({ modelName: "claude-haiku-4.5" });

    expect(provider).toBe("anthropic");
    expect(apiModelId).toBe("claude-haiku-4.5");
  });

  // ─── Provider backends (STIGMER_ANTHROPIC_BACKEND) ─────────────────────────

  describe("vertex backend", () => {
    beforeEach(() => {
      process.env.STIGMER_ANTHROPIC_BACKEND = "vertex";
      process.env.CLOUD_ML_REGION = "asia-south1";
    });

    it("holds the canonical-id invariant: translated id on the wire, canonical id returned", async () => {
      mockRegistryResponse([
        { id: "claude-sonnet-4.5", apiModelId: "claude-sonnet-4-5-20250929", provider: "anthropic" },
      ]);

      const { apiModelId } = await buildChatModel({ modelName: "claude-sonnet-4.5" });

      // Pricing and usage metrics key on the canonical id; only the
      // constructor (the wire) sees the Vertex `@date` form.
      expect(apiModelId).toBe("claude-sonnet-4-5-20250929");
      const args = lastAnthropicArgs();
      expect(args.model).toBe("claude-sonnet-4-5@20250929");
      expect(typeof args.createClient).toBe("function");
    });

    it("passes dateless 4.6-generation ids to the wire untranslated", async () => {
      mockRegistryResponse([
        { id: "claude-sonnet-4.6", apiModelId: "claude-sonnet-4-6", provider: "anthropic" },
      ]);

      await buildChatModel({ modelName: "claude-sonnet-4.6" });

      expect(lastAnthropicArgs().model).toBe("claude-sonnet-4-6");
    });

    it("constructs without ANTHROPIC_API_KEY (auth is Google's, not Anthropic's)", async () => {
      mockRegistryResponse([
        { id: "claude-sonnet-4.6", apiModelId: "claude-sonnet-4-6", provider: "anthropic" },
      ]);

      await buildChatModel({ modelName: "claude-sonnet-4.6" });

      expect(lastAnthropicArgs().apiKey).toBe("");
    });

    it("yields to the proxy: a proxied call never consults the backend var", async () => {
      mockRegistryResponse([
        { id: "claude-sonnet-4.6", apiModelId: "claude-sonnet-4-6", provider: "anthropic" },
      ]);

      await buildChatModel({
        modelName: "claude-sonnet-4.6",
        proxyEndpoint: "https://api.stigmer.ai",
        stigmerToken: "tok",
      });

      const args = lastAnthropicArgs();
      expect(args).not.toHaveProperty("createClient");
      expect(args.model).toBe("claude-sonnet-4-6");
      expect(args).toMatchObject({
        clientOptions: { baseURL: "https://api.stigmer.ai/v1/proxy/llm/anthropic" },
      });
    });

    it("leaves the OpenAI path untouched by the Anthropic backend var", async () => {
      mockRegistryResponse([
        { id: "gpt-4.1", apiModelId: "gpt-4.1", provider: "openai" },
      ]);

      await buildChatModel({ modelName: "gpt-4.1" });

      const args = mockOpenAICtor.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(args).not.toHaveProperty("createClient");
      expect(mockAnthropicCtor).not.toHaveBeenCalled();
    });

    it("fails at dispatch with the region message when CLOUD_ML_REGION is missing", async () => {
      // Defense in depth for paths that bypass the factories' preflight.
      delete process.env.CLOUD_ML_REGION;
      mockRegistryResponse([
        { id: "claude-sonnet-4.6", apiModelId: "claude-sonnet-4-6", provider: "anthropic" },
      ]);

      await expect(buildChatModel({ modelName: "claude-sonnet-4.6" }))
        .rejects.toThrow(/CLOUD_ML_REGION/);
      expect(mockAnthropicCtor).not.toHaveBeenCalled();
    });
  });

  it("throws the parser's message on an invalid backend value (never a silent public fallback)", async () => {
    process.env.STIGMER_ANTHROPIC_BACKEND = "verteks";
    mockRegistryResponse([
      { id: "claude-sonnet-4.6", apiModelId: "claude-sonnet-4-6", provider: "anthropic" },
    ]);

    await expect(buildChatModel({ modelName: "claude-sonnet-4.6" }))
      .rejects.toThrow(/STIGMER_ANTHROPIC_BACKEND="verteks" is not a supported backend/);
  });
});
