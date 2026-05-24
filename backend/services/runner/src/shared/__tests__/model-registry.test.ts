import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getSummarizationModel, getEconomyModel, _resetRegistryCache } from "../model-registry.js";

describe("getSummarizationModel", () => {
  beforeEach(() => {
    _resetRegistryCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    _resetRegistryCache();
  });

  it("returns gpt-4o-mini for an OpenAI model", async () => {
    mockRegistryResponse([
      { id: "gpt-4.1", provider: "openai", costTier: "standard", harness: "native" },
      { id: "gpt-4o-mini", provider: "openai", costTier: "economy", harness: "native" },
    ]);

    const result = await getSummarizationModel("gpt-4.1");
    expect(result).toBe("gpt-4o-mini");
  });

  it("returns claude-haiku-4.5 for an Anthropic model", async () => {
    mockRegistryResponse([
      { id: "claude-opus-4", provider: "anthropic", costTier: "premium", harness: "native" },
      { id: "claude-haiku-4.5", provider: "anthropic", costTier: "economy", harness: "native" },
    ]);

    const result = await getSummarizationModel("claude-opus-4");
    expect(result).toBe("claude-haiku-4.5");
  });

  it("returns the primary model itself for Ollama (no economy tier)", async () => {
    mockRegistryResponse([
      { id: "qwen2.5-coder:7b", provider: "ollama", costTier: "economy", harness: "native" },
    ]);

    const result = await getSummarizationModel("qwen2.5-coder:7b");
    expect(result).toBe("qwen2.5-coder:7b");
  });

  it("falls back to cross-provider economy model when primary not found", async () => {
    mockRegistryResponse([
      { id: "gpt-4.1", provider: "openai", costTier: "standard", harness: "native" },
      { id: "claude-haiku-4.5", provider: "anthropic", costTier: "economy", harness: "native" },
    ]);

    const result = await getSummarizationModel("unknown-model-xyz");
    expect(result).toBe("claude-haiku-4.5");
  });

  it("returns the primary model when registry fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network error"));

    const result = await getSummarizationModel("gpt-4.1");
    expect(result).toBe("gpt-4.1");
  });

  it("caches registry data across multiple calls", async () => {
    const fetchSpy = mockRegistryResponse([
      { id: "gpt-4.1", provider: "openai", costTier: "standard", harness: "native" },
      { id: "gpt-4o-mini", provider: "openai", costTier: "economy", harness: "native" },
    ]);

    await getSummarizationModel("gpt-4.1");
    await getSummarizationModel("gpt-4.1");
    await getSummarizationModel("gpt-4.1");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("prefers same-provider economy model over cross-provider", async () => {
    mockRegistryResponse([
      { id: "gpt-4.1", provider: "openai", costTier: "standard", harness: "native" },
      { id: "gpt-4o-mini", provider: "openai", costTier: "economy", harness: "native" },
      { id: "claude-haiku-4.5", provider: "anthropic", costTier: "economy", harness: "native" },
    ]);

    const result = await getEconomyModel("gpt-4.1");
    expect(result).toBe("gpt-4o-mini");
  });

  it("only selects native harness models for extraction", async () => {
    mockRegistryResponse([
      { id: "claude-sonnet-4", provider: "anthropic", costTier: "standard", harness: "cursor" },
      { id: "claude-haiku-4-5", provider: "anthropic", costTier: "economy", harness: "cursor" },
      { id: "claude-haiku-4.5", provider: "anthropic", costTier: "economy", harness: "native" },
    ]);

    const result = await getEconomyModel("claude-sonnet-4");
    expect(result).toBe("claude-haiku-4.5");
  });
});

function mockRegistryResponse(models: Array<{ id: string; provider: string; costTier: string; harness: string }>) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ models }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}
