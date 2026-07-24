import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getSummarizationModel,
  getEconomyModel,
  getDefaultModel,
  resolveToApiModelId,
  _resetRegistryCache,
} from "../model-registry.js";

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

  it("resolves to the primary model itself for a single-model provider", async () => {
    // Fabricated provider: exercises generic same-provider economy resolution
    // for providers with exactly one (economy) model.
    mockRegistryResponse([
      { id: "solo-model-1", provider: "someprovider", costTier: "economy", harness: "native" },
    ]);

    const result = await getSummarizationModel("solo-model-1");
    expect(result).toBe("solo-model-1");
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

describe("getDefaultModel", () => {
  beforeEach(() => {
    _resetRegistryCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    _resetRegistryCache();
  });

  it("returns apiModelId of featured+standard+native model", async () => {
    mockRegistryResponse([
      { id: "claude-opus-4.6", provider: "anthropic", costTier: "premium", harness: "native", featured: true },
      { id: "claude-sonnet-4.6", apiModelId: "claude-sonnet-4-6", provider: "anthropic", costTier: "standard", harness: "native", featured: true },
      { id: "claude-haiku-4.5", provider: "anthropic", costTier: "economy", harness: "native", featured: true },
    ]);

    const result = await getDefaultModel();
    expect(result).toBe("claude-sonnet-4-6");
  });

  it("falls back to non-featured standard+native when no featured model", async () => {
    mockRegistryResponse([
      { id: "claude-sonnet-4.5", apiModelId: "claude-sonnet-4-5-20250929", provider: "anthropic", costTier: "standard", harness: "native" },
      { id: "claude-haiku-4.5", provider: "anthropic", costTier: "economy", harness: "native" },
    ]);

    const result = await getDefaultModel();
    expect(result).toBe("claude-sonnet-4-5-20250929");
  });

  it("returns hardcoded fallback when registry is empty", async () => {
    mockRegistryResponse([]);

    const result = await getDefaultModel();
    expect(result).toBe("claude-sonnet-4-6");
  });

  it("returns hardcoded fallback when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network error"));

    const result = await getDefaultModel();
    expect(result).toBe("claude-sonnet-4-6");
  });

  it("respects registry ordering (first featured+standard+native wins)", async () => {
    mockRegistryResponse([
      { id: "claude-sonnet-4.6", apiModelId: "claude-sonnet-4-6", provider: "anthropic", costTier: "standard", harness: "native", featured: true },
      { id: "gpt-4.1", apiModelId: "gpt-4.1", provider: "openai", costTier: "standard", harness: "native", featured: true },
    ]);

    const result = await getDefaultModel();
    expect(result).toBe("claude-sonnet-4-6");
  });

  it("skips cursor-harness models", async () => {
    mockRegistryResponse([
      { id: "claude-sonnet-4-6", provider: "anthropic", costTier: "standard", harness: "cursor", featured: true },
      { id: "gpt-4.1", apiModelId: "gpt-4.1", provider: "openai", costTier: "standard", harness: "native" },
    ]);

    const result = await getDefaultModel();
    expect(result).toBe("gpt-4.1");
  });

  it("falls back to id when apiModelId is absent", async () => {
    mockRegistryResponse([
      { id: "gpt-4o-mini", provider: "openai", costTier: "standard", harness: "native", featured: true },
    ]);

    const result = await getDefaultModel();
    expect(result).toBe("gpt-4o-mini");
  });

  it("returns fallback when only economy and premium models exist", async () => {
    mockRegistryResponse([
      { id: "claude-opus-4.6", provider: "anthropic", costTier: "premium", harness: "native", featured: true },
      { id: "claude-haiku-4.5", provider: "anthropic", costTier: "economy", harness: "native", featured: true },
    ]);

    const result = await getDefaultModel();
    expect(result).toBe("claude-sonnet-4-6");
  });
});

describe("resolveToApiModelId", () => {
  beforeEach(() => {
    _resetRegistryCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    _resetRegistryCache();
    vi.useRealTimers();
  });

  it("resolves a canonical registry id to the provider api id", async () => {
    mockRegistryResponse([
      { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", provider: "anthropic", costTier: "economy", harness: "native" },
    ]);

    const result = await resolveToApiModelId("claude-haiku-4.5");
    expect(result).toBe("claude-haiku-4-5-20251001");
  });

  it("passes unknown ids through unchanged (provider api ids stay verbatim)", async () => {
    mockRegistryResponse([
      { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", provider: "anthropic", costTier: "economy", harness: "native" },
    ]);

    const result = await resolveToApiModelId("claude-haiku-4-5-20251001");
    expect(result).toBe("claude-haiku-4-5-20251001");
  });

  it("degrades to pass-through when the registry fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network error"));

    const result = await resolveToApiModelId("claude-haiku-4.5");
    expect(result).toBe("claude-haiku-4.5");
  });

  it("retries after the short failure TTL instead of caching the failure for an hour", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            models: [
              { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", provider: "anthropic", costTier: "economy", harness: "native" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    // First call fails and degrades to pass-through.
    expect(await resolveToApiModelId("claude-haiku-4.5")).toBe("claude-haiku-4.5");

    // Within the failure TTL the empty result stays cached (no refetch).
    vi.advanceTimersByTime(30_000);
    expect(await resolveToApiModelId("claude-haiku-4.5")).toBe("claude-haiku-4.5");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Past the failure TTL the registry is refetched and resolution recovers.
    vi.advanceTimersByTime(31_000);
    expect(await resolveToApiModelId("claude-haiku-4.5")).toBe("claude-haiku-4-5-20251001");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

interface MockModel {
  id: string;
  apiModelId?: string;
  provider: string;
  costTier: string;
  harness: string;
  featured?: boolean;
}

function mockRegistryResponse(models: MockModel[]) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ models }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}
