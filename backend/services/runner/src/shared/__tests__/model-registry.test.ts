import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getSummarizationModel,
  getEconomyModel,
  getDefaultModel,
  getModelVisionCapability,
  getRequestProfile,
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
      { id: "claude-sonnet-4", provider: "anthropic", costTier: "standard", harness: "claude" },
      { id: "claude-haiku-4-5", provider: "anthropic", costTier: "economy", harness: "claude" },
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

    const result = await getDefaultModel("native");
    expect(result).toBe("claude-sonnet-4-6");
  });

  it("falls back to non-featured standard+native when no featured model", async () => {
    mockRegistryResponse([
      { id: "claude-sonnet-4.5", apiModelId: "claude-sonnet-4-5-20250929", provider: "anthropic", costTier: "standard", harness: "native" },
      { id: "claude-haiku-4.5", provider: "anthropic", costTier: "economy", harness: "native" },
    ]);

    const result = await getDefaultModel("native");
    expect(result).toBe("claude-sonnet-4-5-20250929");
  });

  it("returns hardcoded fallback when registry is empty", async () => {
    mockRegistryResponse([]);

    const result = await getDefaultModel("native");
    expect(result).toBe("claude-sonnet-4-6");
  });

  it("returns hardcoded fallback when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network error"));

    const result = await getDefaultModel("native");
    expect(result).toBe("claude-sonnet-4-6");
  });

  it("respects registry ordering (first featured+standard+native wins)", async () => {
    mockRegistryResponse([
      { id: "claude-sonnet-4.6", apiModelId: "claude-sonnet-4-6", provider: "anthropic", costTier: "standard", harness: "native", featured: true },
      { id: "gpt-4.1", apiModelId: "gpt-4.1", provider: "openai", costTier: "standard", harness: "native", featured: true },
    ]);

    const result = await getDefaultModel("native");
    expect(result).toBe("claude-sonnet-4-6");
  });

  it("skips another harness's models", async () => {
    mockRegistryResponse([
      { id: "claude-sonnet-4-6", provider: "anthropic", costTier: "standard", harness: "claude", featured: true },
      { id: "gpt-4.1", apiModelId: "gpt-4.1", provider: "openai", costTier: "standard", harness: "native" },
    ]);

    const result = await getDefaultModel("native");
    expect(result).toBe("gpt-4.1");
  });

  it("reads each engine's own section: the Claude engine's default is its own row's", async () => {
    mockRegistryResponse([
      { id: "claude-sonnet-4.6", apiModelId: "claude-sonnet-4-6", provider: "anthropic", costTier: "standard", harness: "native", featured: true },
      { id: "claude-sonnet-5", apiModelId: "claude-sonnet-5", provider: "anthropic", costTier: "standard", harness: "claude", featured: true },
    ]);

    expect(await getDefaultModel("claude")).toBe("claude-sonnet-5");
    expect(await getDefaultModel("native")).toBe("claude-sonnet-4-6");
  });

  it("falls back to id when apiModelId is absent", async () => {
    mockRegistryResponse([
      { id: "gpt-4o-mini", provider: "openai", costTier: "standard", harness: "native", featured: true },
    ]);

    const result = await getDefaultModel("native");
    expect(result).toBe("gpt-4o-mini");
  });

  it("returns fallback when only economy and premium models exist", async () => {
    mockRegistryResponse([
      { id: "claude-opus-4.6", provider: "anthropic", costTier: "premium", harness: "native", featured: true },
      { id: "claude-haiku-4.5", provider: "anthropic", costTier: "economy", harness: "native", featured: true },
    ]);

    const result = await getDefaultModel("native");
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

  it("recovers from a transient network failure without engaging the failure cache (#468)", async () => {
    // undici's retryable shape (TypeError) — the shared bounded-backoff loop
    // absorbs it, so resolution succeeds on the SAME call and the 60 s
    // degraded window never opens. Pre-#468 code failed the fetch outright.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
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

    expect(await resolveToApiModelId("claude-haiku-4.5")).toBe("claude-haiku-4-5-20251001");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
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

describe("getModelVisionCapability", () => {
  beforeEach(() => {
    _resetRegistryCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    _resetRegistryCache();
  });

  it("returns the explicit vision flag when the capabilities block is present", async () => {
    mockRegistryResponse([
      { id: "claude-sonnet-4.6", provider: "anthropic", costTier: "standard", harness: "native", capabilities: { vision: true, toolUse: true } },
      { id: "llama3.1", provider: "ollama", costTier: "economy", harness: "native", capabilities: { vision: false, toolUse: true } },
    ]);

    expect(await getModelVisionCapability("claude-sonnet-4.6")).toBe(true);
    _resetRegistryCache();
    mockRegistryResponse([
      { id: "llama3.1", provider: "ollama", costTier: "economy", harness: "native", capabilities: { vision: false } },
    ]);
    expect(await getModelVisionCapability("llama3.1")).toBe(false);
  });

  it("returns undefined when the capabilities block is absent (never assessed ≠ blind)", async () => {
    // A row with pricing and UI fields and no capabilities block must stay
    // undefined, never coerce to false.
    mockRegistryResponse([
      { id: "claude-unassessed", provider: "anthropic", costTier: "economy", harness: "native" },
    ]);

    expect(await getModelVisionCapability("claude-unassessed")).toBeUndefined();
  });

  it("matches by apiModelId as well as registry id", async () => {
    // getDefaultModel("native") hands the deep-agent harness the provider API id, so
    // both identifier forms must resolve to the same capability.
    mockRegistryResponse([
      { id: "claude-sonnet-4.6", apiModelId: "claude-sonnet-4-6", provider: "anthropic", costTier: "standard", harness: "native", capabilities: { vision: true } },
    ]);

    expect(await getModelVisionCapability("claude-sonnet-4-6")).toBe(true);
  });

  it("returns undefined for unknown names, the empty string, and the Auto pool", async () => {
    mockRegistryResponse([
      { id: "claude-sonnet-4.6", provider: "anthropic", costTier: "standard", harness: "native", capabilities: { vision: true } },
    ]);

    expect(await getModelVisionCapability("never-heard-of-it")).toBeUndefined();
    expect(await getModelVisionCapability("")).toBeUndefined();
    expect(await getModelVisionCapability("default")).toBeUndefined();
  });

  it("returns undefined when the registry fetch fails (fail-open)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network error"));

    expect(await getModelVisionCapability("claude-sonnet-4.6")).toBeUndefined();
  });

  it("treats a malformed capabilities value as undefined", async () => {
    mockRegistryResponse([
      { id: "weird-model", provider: "anthropic", costTier: "standard", harness: "native", capabilities: "yes" as unknown as { vision?: boolean } },
    ]);

    expect(await getModelVisionCapability("weird-model")).toBeUndefined();
  });
});

describe("getRequestProfile", () => {
  beforeEach(() => {
    _resetRegistryCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    _resetRegistryCache();
  });

  const NO_THINKING = { shape: "none", required: undefined } as const;

  it("reads the native row, never the same id's claude row", async () => {
    mockRegistryResponse([
      { id: "claude-sonnet-5", provider: "anthropic", costTier: "standard", harness: "claude", maxOutputTokens: 64000, capabilities: { thinking: true, adaptiveThinking: false } },
      { id: "claude-sonnet-5", apiModelId: "claude-sonnet-5", provider: "anthropic", costTier: "standard", harness: "native", maxOutputTokens: 128000, capabilities: { thinking: false, adaptiveThinking: true, thinkingRequired: false } },
    ]);

    expect(await getRequestProfile("claude-sonnet-5", "native")).toEqual({
      maxOutputTokens: 128000,
      thinking: { shape: "adaptive", required: false },
    });
  });

  it("reads the asked engine's own row: the Claude row for the Claude engine, none on an engine that does not list the model", async () => {
    mockRegistryResponse([
      { id: "claude-opus-4.5", provider: "anthropic", costTier: "premium", harness: "native", capabilities: { thinking: true, adaptiveThinking: false, thinkingRequired: false } },
      { id: "claude-opus-4.5", provider: "anthropic", costTier: "premium", harness: "claude", capabilities: { thinking: false, adaptiveThinking: true, thinkingRequired: true } },
      { id: "native-only", provider: "anthropic", costTier: "standard", harness: "native", capabilities: { adaptiveThinking: true } },
    ]);

    expect((await getRequestProfile("claude-opus-4.5", "claude"))?.thinking).toEqual({ shape: "adaptive", required: true });
    expect((await getRequestProfile("claude-opus-4.5", "native"))?.thinking).toEqual({ shape: "budget", required: false });
    expect(await getRequestProfile("native-only", "claude")).toBeUndefined();
  });

  it("matches the provider api id as well as the registry id", async () => {
    mockRegistryResponse([
      { id: "claude-sonnet-4.6", apiModelId: "claude-sonnet-4-6", provider: "anthropic", costTier: "standard", harness: "native", maxOutputTokens: 65536 },
    ]);

    expect(await getRequestProfile("claude-sonnet-4-6", "native")).toEqual({ maxOutputTokens: 65536, thinking: NO_THINKING });
    expect(await getRequestProfile("claude-sonnet-4.6", "native")).toEqual({ maxOutputTokens: 65536, thinking: NO_THINKING });
  });

  it("derives the thinking shape from the capability flags, adaptive winning over budget", async () => {
    mockRegistryResponse([
      { id: "budget", provider: "anthropic", costTier: "standard", harness: "native", capabilities: { thinking: true, adaptiveThinking: false } },
      { id: "adaptive", provider: "anthropic", costTier: "standard", harness: "native", capabilities: { thinking: false, adaptiveThinking: true } },
      { id: "both", provider: "anthropic", costTier: "standard", harness: "native", capabilities: { thinking: true, adaptiveThinking: true } },
      { id: "neither", provider: "anthropic", costTier: "standard", harness: "native", capabilities: { thinking: false, adaptiveThinking: false } },
    ]);

    expect((await getRequestProfile("budget", "native"))?.thinking.shape).toBe("budget");
    expect((await getRequestProfile("adaptive", "native"))?.thinking.shape).toBe("adaptive");
    expect((await getRequestProfile("both", "native"))?.thinking.shape).toBe("adaptive");
    expect((await getRequestProfile("neither", "native"))?.thinking.shape).toBe("none");
  });

  it("keeps thinkingRequired tri-state: stated true, stated false, and never assessed", async () => {
    mockRegistryResponse([
      { id: "always", provider: "anthropic", costTier: "premium", harness: "native", capabilities: { adaptiveThinking: true, thinkingRequired: true } },
      { id: "optional", provider: "anthropic", costTier: "standard", harness: "native", capabilities: { adaptiveThinking: true, thinkingRequired: false } },
      { id: "unassessed", provider: "anthropic", costTier: "standard", harness: "native", capabilities: { adaptiveThinking: true } },
      { id: "malformed", provider: "anthropic", costTier: "standard", harness: "native", capabilities: { adaptiveThinking: true, thinkingRequired: "yes" } },
      { id: "no-block", provider: "anthropic", costTier: "standard", harness: "native" },
    ]);

    expect((await getRequestProfile("always", "native"))?.thinking.required).toBe(true);
    expect((await getRequestProfile("optional", "native"))?.thinking.required).toBe(false);
    expect((await getRequestProfile("unassessed", "native"))?.thinking.required).toBeUndefined();
    expect((await getRequestProfile("malformed", "native"))?.thinking.required).toBeUndefined();
    expect((await getRequestProfile("no-block", "native"))?.thinking).toEqual(NO_THINKING);
  });

  it("states no ceiling when the row's value is absent or not a positive integer", async () => {
    mockRegistryResponse([
      { id: "a", provider: "anthropic", costTier: "standard", harness: "native" },
      { id: "b", provider: "anthropic", costTier: "standard", harness: "native", maxOutputTokens: "128000" },
      { id: "c", provider: "anthropic", costTier: "standard", harness: "native", maxOutputTokens: 0 },
      { id: "d", provider: "anthropic", costTier: "standard", harness: "native", maxOutputTokens: 1.5 },
    ]);

    for (const id of ["a", "b", "c", "d"]) {
      expect((await getRequestProfile(id, "native"))?.maxOutputTokens).toBeUndefined();
    }
  });

  it("reads the row's context window, and states none when it is absent or not a positive integer", async () => {
    mockRegistryResponse([
      { id: "sized", provider: "anthropic", costTier: "standard", harness: "native", contextWindowTokens: 1_000_000 },
      { id: "unsized", provider: "anthropic", costTier: "standard", harness: "native" },
      { id: "malformed", provider: "anthropic", costTier: "standard", harness: "native", contextWindowTokens: "200000" },
    ]);

    expect((await getRequestProfile("sized", "native"))?.contextWindowTokens).toBe(1_000_000);
    expect((await getRequestProfile("unsized", "native"))?.contextWindowTokens).toBeUndefined();
    expect((await getRequestProfile("malformed", "native"))?.contextWindowTokens).toBeUndefined();
  });

  it("returns undefined for no concrete model, an unknown model, another harness's model, and an unreachable registry", async () => {
    mockRegistryResponse([
      { id: "claude-only", provider: "anthropic", costTier: "economy", harness: "claude", maxOutputTokens: 64000 },
    ]);

    expect(await getRequestProfile("default", "native")).toBeUndefined();
    expect(await getRequestProfile("", "native")).toBeUndefined();
    expect(await getRequestProfile("claude-only", "native")).toBeUndefined();
    expect(await getRequestProfile("no-such-model", "native")).toBeUndefined();

    _resetRegistryCache();
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await getRequestProfile("claude-sonnet-5", "native")).toBeUndefined();
  });
});

interface MockModel {
  id: string;
  apiModelId?: string;
  provider: string;
  costTier: string;
  harness: string;
  featured?: boolean;
  capabilities?: { vision?: boolean; toolUse?: boolean; thinking?: boolean; adaptiveThinking?: boolean; thinkingRequired?: unknown };
  maxOutputTokens?: unknown;
  contextWindowTokens?: unknown;
}

function mockRegistryResponse(models: MockModel[]) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ models }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}
