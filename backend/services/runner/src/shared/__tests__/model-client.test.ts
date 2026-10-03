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
import { ServiceTier } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

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
    delete process.env.STIGMER_LLM_REQUEST_TIMEOUT_MS;
    delete process.env.ANTHROPIC_BASE_URL;
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

  it("pins temperature 0 by default, and sends none when the caller passes null", async () => {
    mockRegistryResponse([
      { id: "claude-opus-4.8", apiModelId: "claude-opus-4-8", provider: "anthropic" },
    ]);

    await buildChatModel({ modelName: "claude-opus-4.8" });
    expect(lastAnthropicArgs()).toMatchObject({ temperature: 0 });

    await buildChatModel({ modelName: "claude-opus-4.8", temperature: 0.3 });
    expect(lastAnthropicArgs()).toMatchObject({ temperature: 0.3 });

    await buildChatModel({ modelName: "claude-opus-4.8", temperature: null });
    expect(lastAnthropicArgs()).not.toHaveProperty("temperature");
  });

  it("passes the model id through unchanged when the registry is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"));

    const { provider, apiModelId } = await buildChatModel({ modelName: "claude-haiku-4.5" });

    expect(provider).toBe("anthropic");
    expect(apiModelId).toBe("claude-haiku-4.5");
  });

  // ─── Request timeout (STIGMER_LLM_REQUEST_TIMEOUT_MS) ──────────────────────
  //
  // The timeout lives in a different slot per wrapper: ChatOpenAI reads it
  // as a constructor field; ChatAnthropic only honors clientOptions.timeout.
  // Putting it in the shared constructor spread was the regression that made
  // the env var inert on every Anthropic path. The backend factories' half
  // of the chain is pinned in the
  // vertex/bedrock/foundry adapter tests.

  describe("request timeout", () => {
    it("places the OpenAI timeout at the constructor level with maxRetries 0", async () => {
      mockRegistryResponse([
        { id: "gpt-4.1", apiModelId: "gpt-4.1", provider: "openai" },
      ]);

      await buildChatModel({ modelName: "gpt-4.1", timeoutMs: 5000 });

      const args = mockOpenAICtor.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(args).toMatchObject({ timeout: 5000, maxRetries: 0 });
    });

    it("places the Anthropic timeout in clientOptions, never the inert constructor slot", async () => {
      mockRegistryResponse([
        { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", provider: "anthropic" },
      ]);

      await buildChatModel({ modelName: "claude-haiku-4.5", timeoutMs: 5000 });

      const args = lastAnthropicArgs();
      expect(args).toMatchObject({ clientOptions: { timeout: 5000 }, maxRetries: 0 });
      expect(args).not.toHaveProperty("timeout");
    });

    it("merges the timeout with the proxy wiring inside one clientOptions block", async () => {
      mockRegistryResponse([
        { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", provider: "anthropic" },
      ]);

      await buildChatModel({
        modelName: "claude-haiku-4.5",
        proxyEndpoint: "https://api.stigmer.ai",
        stigmerToken: "tok-123",
        timeoutMs: 5000,
      });

      expect(lastAnthropicArgs()).toMatchObject({
        clientOptions: {
          timeout: 5000,
          baseURL: "https://api.stigmer.ai/v1/proxy/llm/anthropic",
        },
      });
    });

    // The env default resolves INSIDE buildChatModel (#468): before this,
    // each caller parsed STIGMER_LLM_REQUEST_TIMEOUT_MS itself, and every
    // caller except the deep-agent main path — including its own sub-agent
    // modelFactory — dropped the bound.
    it("defaults to STIGMER_LLM_REQUEST_TIMEOUT_MS when the caller passes no timeout", async () => {
      process.env.STIGMER_LLM_REQUEST_TIMEOUT_MS = "7000";
      mockRegistryResponse([
        { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", provider: "anthropic" },
      ]);

      await buildChatModel({ modelName: "claude-haiku-4.5" });

      expect(lastAnthropicArgs()).toMatchObject({
        clientOptions: { timeout: 7000 },
        maxRetries: 0,
      });
    });

    it("lets an explicit caller timeout win over the env default", async () => {
      process.env.STIGMER_LLM_REQUEST_TIMEOUT_MS = "7000";
      mockRegistryResponse([
        { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", provider: "anthropic" },
      ]);

      await buildChatModel({ modelName: "claude-haiku-4.5", timeoutMs: 5000 });

      expect(lastAnthropicArgs()).toMatchObject({ clientOptions: { timeout: 5000 } });
    });

    it.each(["0", "-1", "not-a-number", ""])(
      "normalizes a non-positive env value (%j) to no bound",
      async (envValue) => {
        process.env.STIGMER_LLM_REQUEST_TIMEOUT_MS = envValue;
        mockRegistryResponse([
          { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", provider: "anthropic" },
        ]);

        await buildChatModel({ modelName: "claude-haiku-4.5" });

        const args = lastAnthropicArgs();
        expect(args).not.toHaveProperty("clientOptions");
        expect(args).not.toHaveProperty("maxRetries");
      },
    );
  });

  // ─── The public API's address (ANTHROPIC_BASE_URL) ─────────────────────────

  describe("the public Anthropic API's address", () => {
    it("sends a direct-mode Anthropic client to ANTHROPIC_BASE_URL, trailing slash dropped", async () => {
      process.env.ANTHROPIC_API_KEY = "sk-direct";
      process.env.ANTHROPIC_BASE_URL = "http://llm-gateway.internal:8080/";
      mockRegistryResponse([
        { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", provider: "anthropic" },
      ]);

      await buildChatModel({ modelName: "claude-haiku-4.5" });

      expect(lastAnthropicArgs()).toMatchObject({
        apiKey: "sk-direct",
        clientOptions: { baseURL: "http://llm-gateway.internal:8080" },
      });
    });

    it("lets the proxy's provider path win over it", async () => {
      process.env.ANTHROPIC_BASE_URL = "http://llm-gateway.internal:8080";
      mockRegistryResponse([
        { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", provider: "anthropic" },
      ]);

      await buildChatModel({
        modelName: "claude-haiku-4.5",
        proxyEndpoint: "https://api.stigmer.ai",
        stigmerToken: "tok",
      });

      expect(lastAnthropicArgs()).toMatchObject({
        clientOptions: { baseURL: "https://api.stigmer.ai/v1/proxy/llm/anthropic" },
      });
    });

    it("leaves a backend adapter on its own endpoint", async () => {
      process.env.ANTHROPIC_BASE_URL = "http://llm-gateway.internal:8080";
      process.env.STIGMER_ANTHROPIC_BACKEND = "vertex";
      process.env.CLOUD_ML_REGION = "asia-south1";
      mockRegistryResponse([
        { id: "claude-sonnet-4.6", apiModelId: "claude-sonnet-4-6", provider: "anthropic" },
      ]);

      await buildChatModel({ modelName: "claude-sonnet-4.6" });

      const args = lastAnthropicArgs();
      expect(args).toHaveProperty("createClient");
      expect(args).not.toHaveProperty("clientOptions");
    });

    it("leaves the OpenAI client on its default address", async () => {
      process.env.ANTHROPIC_BASE_URL = "http://llm-gateway.internal:8080";
      mockRegistryResponse([
        { id: "gpt-4.1", apiModelId: "gpt-4.1", provider: "openai" },
      ]);

      await buildChatModel({ modelName: "gpt-4.1" });

      const args = mockOpenAICtor.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(args).not.toHaveProperty("configuration");
    });

    it("refuses a value that is not an http(s) URL instead of sending to it", async () => {
      process.env.ANTHROPIC_BASE_URL = "llm-gateway.internal:8080";
      mockRegistryResponse([
        { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", provider: "anthropic" },
      ]);

      await expect(buildChatModel({ modelName: "claude-haiku-4.5" }))
        .rejects.toThrow(/ANTHROPIC_BASE_URL="llm-gateway.internal:8080" is not an http\(s\) URL/);
      expect(mockAnthropicCtor).not.toHaveBeenCalled();
    });
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

    it("does NOT send service_tier on a backend adapter — tiers are Anthropic-first-party billing, and Vertex/Bedrock/Foundry have no tier dimension", async () => {
      mockRegistryResponse([
        { id: "claude-sonnet-4.6", apiModelId: "claude-sonnet-4-6", provider: "anthropic" },
      ]);

      await buildChatModel({ modelName: "claude-sonnet-4.6", serviceTier: ServiceTier.STANDARD });

      const args = lastAnthropicArgs();
      expect(typeof args.createClient).toBe("function");
      expect(args).not.toHaveProperty("invocationKwargs");
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

  describe("thinking and streaming (the native execution turn)", () => {
    it("Anthropic: the mapped thinking parameter is the wrapper's own `thinking` field", async () => {
      mockRegistryResponse([
        { id: "claude-sonnet-5", apiModelId: "claude-sonnet-5", provider: "anthropic" },
      ]);

      await buildChatModel({ modelName: "claude-sonnet-5", thinking: { type: "adaptive", display: "summarized" } });

      expect(lastAnthropicArgs()).toMatchObject({ thinking: { type: "adaptive", display: "summarized" } });
    });

    it("an explicit disabled rides the same field, so the provider's default cannot turn thinking on", async () => {
      mockRegistryResponse([
        { id: "claude-sonnet-5", apiModelId: "claude-sonnet-5", provider: "anthropic" },
      ]);

      await buildChatModel({ modelName: "claude-sonnet-5", thinking: { type: "disabled" } });

      expect(lastAnthropicArgs()).toMatchObject({ thinking: { type: "disabled" } });
    });

    it("an omitted thinking parameter sends none, and streaming is off unless asked for", async () => {
      mockRegistryResponse([
        { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", provider: "anthropic" },
      ]);

      await buildChatModel({ modelName: "claude-haiku-4.5" });

      expect(lastAnthropicArgs()).not.toHaveProperty("thinking");
      expect(lastAnthropicArgs()).not.toHaveProperty("streaming");
    });

    it("streaming and the row's ceiling reach the wrapper when the caller sets them", async () => {
      mockRegistryResponse([
        { id: "claude-opus-4.8", apiModelId: "claude-opus-4-8", provider: "anthropic" },
      ]);

      await buildChatModel({ modelName: "claude-opus-4.8", maxTokens: 128000, streaming: true });

      expect(lastAnthropicArgs()).toMatchObject({ maxTokens: 128000, streaming: true });
    });

    it("thinking rides a backend request too — unlike the tier, it exists on every Anthropic platform", async () => {
      process.env.STIGMER_ANTHROPIC_BACKEND = "vertex";
      process.env.CLOUD_ML_REGION = "asia-south1";
      mockRegistryResponse([
        { id: "claude-sonnet-4.5", apiModelId: "claude-sonnet-4-5-20250929", provider: "anthropic" },
      ]);

      await buildChatModel({
        modelName: "claude-sonnet-4.5",
        thinking: { type: "enabled", budget_tokens: 16000 },
        serviceTier: ServiceTier.STANDARD,
      });

      const args = lastAnthropicArgs();
      expect(args).toMatchObject({ thinking: { type: "enabled", budget_tokens: 16000 } });
      expect(args).not.toHaveProperty("invocationKwargs");
    });

    it("a thinking parameter for a non-Anthropic model is refused, never silently dropped", async () => {
      mockRegistryResponse([
        { id: "gpt-4.1", apiModelId: "gpt-4.1", provider: "openai" },
      ]);

      await expect(
        buildChatModel({ modelName: "gpt-4.1", thinking: { type: "adaptive" } }),
      ).rejects.toThrow(/only Anthropic models have a native thinking mapping/);
      expect(mockOpenAICtor).not.toHaveBeenCalled();
    });
  });

  describe("service tier (stigmer/stigmer#361)", () => {
    // The #357 contract on the native harness: when the caller passes the
    // execution's effective tier, every provider request pins it
    // explicitly, so the provider ACCOUNT's default can never pick the
    // price. Each provider has its own spelling; both are pinned here so
    // a wrapper upgrade that moves the slot fails loudly.

    it("OpenAI: STANDARD pins service_tier 'default' — never 'auto', which would re-open the account-default hole", async () => {
      mockRegistryResponse([
        { id: "gpt-4.1", apiModelId: "gpt-4.1", provider: "openai" },
      ]);

      await buildChatModel({ modelName: "gpt-4.1", serviceTier: ServiceTier.STANDARD });

      const args = mockOpenAICtor.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(args).toMatchObject({ service_tier: "default" });
    });

    it("OpenAI: FAST pins service_tier 'priority'", async () => {
      mockRegistryResponse([
        { id: "gpt-4.1", apiModelId: "gpt-4.1", provider: "openai" },
      ]);

      await buildChatModel({ modelName: "gpt-4.1", serviceTier: ServiceTier.FAST });

      const args = mockOpenAICtor.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(args).toMatchObject({ service_tier: "priority" });
    });

    it("Anthropic: STANDARD rides invocationKwargs as 'standard_only' — priority capacity is never consumed implicitly", async () => {
      mockRegistryResponse([
        { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", provider: "anthropic" },
      ]);

      await buildChatModel({ modelName: "claude-haiku-4.5", serviceTier: ServiceTier.STANDARD });

      expect(lastAnthropicArgs()).toMatchObject({
        invocationKwargs: { service_tier: "standard_only" },
      });
    });

    it("Anthropic: FAST rides invocationKwargs as 'auto' — use purchased priority capacity when available", async () => {
      mockRegistryResponse([
        { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", provider: "anthropic" },
      ]);

      await buildChatModel({ modelName: "claude-haiku-4.5", serviceTier: ServiceTier.FAST });

      expect(lastAnthropicArgs()).toMatchObject({
        invocationKwargs: { service_tier: "auto" },
      });
    });

    it("an omitted tier sends NO tier parameter on either provider — platform-internal utility calls stay untiered", async () => {
      mockRegistryResponse([
        { id: "gpt-4.1", apiModelId: "gpt-4.1", provider: "openai" },
      ]);
      await buildChatModel({ modelName: "gpt-4.1" });
      const openAiArgs = mockOpenAICtor.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(openAiArgs).not.toHaveProperty("service_tier");

      mockRegistryResponse([
        { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", provider: "anthropic" },
      ]);
      await buildChatModel({ modelName: "claude-haiku-4.5" });
      expect(lastAnthropicArgs()).not.toHaveProperty("invocationKwargs");
    });

    it("the tier rides the proxy path too — the request body parameter is what the proxy meters", async () => {
      mockRegistryResponse([
        { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", provider: "anthropic" },
      ]);

      await buildChatModel({
        modelName: "claude-haiku-4.5",
        proxyEndpoint: "https://api.stigmer.ai",
        stigmerToken: "token",
        serviceTier: ServiceTier.STANDARD,
      });

      expect(lastAnthropicArgs()).toMatchObject({
        invocationKwargs: { service_tier: "standard_only" },
      });
    });
  });
});
