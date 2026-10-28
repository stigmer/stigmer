/**
 * Pins that the server and the runner pick the same default model from the
 * same registry document. The runner decides which model a run with no model
 * named executes on an engine (`getDefaultModel`); the server's catalog answers the same
 * question (`defaultModel`) so the cloud's run admission can tell, before the
 * runner starts, which provider key such a run needs. Two implementations of
 * one rule drift silently, so this test runs both over the server's committed
 * registry and over hand-made documents, and fails the day they disagree.
 *
 * It reads the server's catalog module by its repository path, the coupling
 * `__test-utils__/real-model-registry.ts` already takes for the registry file.
 */
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newModelCatalogProviderFromDocument } from "../../../../stigmer-server/src/modelcatalog/document-catalog.js";
import { REAL_REGISTRY_PATH } from "../../__test-utils__/real-model-registry.js";
import { inferProvider } from "../llm-proxy.js";
import { _resetRegistryCache, getDefaultModel, type RegistryHarness } from "../model-registry.js";

function serveRegistry(document: string): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(document, { status: 200, headers: { "Content-Type": "application/json" } }),
  );
}

async function bothDefaults(document: string, engine: RegistryHarness = "native"): Promise<{ runner: string; server: string | undefined }> {
  _resetRegistryCache();
  serveRegistry(document);
  const runner = await getDefaultModel(engine);
  const server = newModelCatalogProviderFromDocument(document).defaultModel(engine);
  return { runner, server };
}

describe("the default model, runner and server", () => {
  beforeEach(() => {
    _resetRegistryCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    _resetRegistryCache();
  });

  it("agree on the server's committed registry, and the server names the provider the runner routes to", async () => {
    const document = readFileSync(REAL_REGISTRY_PATH, "utf-8");
    const { runner, server } = await bothDefaults(document);
    expect(server).toBe(runner);
    const catalog = newModelCatalogProviderFromDocument(document);
    expect(catalog.providerOf("native", runner)).toBe(inferProvider(runner));
  });

  it("agree on the Claude engine's own default in the server's committed registry", async () => {
    const document = readFileSync(REAL_REGISTRY_PATH, "utf-8");
    const { runner, server } = await bothDefaults(document, "claude");
    expect(server).toBe(runner);
    expect(newModelCatalogProviderFromDocument(document).providerOf("claude", runner)).toBe("anthropic");
  });

  it("agree when the first featured standard entry comes after a plain one", async () => {
    const document = JSON.stringify({
      models: [
        { id: "cheap", provider: "anthropic", harness: "native", costTier: "economy", featured: true },
        { id: "gpt-plain", provider: "openai", harness: "native", costTier: "standard" },
        { id: "claude-star", apiModelId: "claude-star-1", provider: "anthropic", harness: "native", costTier: "standard", featured: true },
      ],
    });
    expect(await bothDefaults(document)).toEqual({ runner: "claude-star-1", server: "claude-star-1" });
  });

  it("agree when no entry is featured, reading a missing cost tier as standard", async () => {
    const document = JSON.stringify({
      models: [
        { id: "cheap", provider: "anthropic", harness: "native", costTier: "economy" },
        { id: "gpt-untiered", provider: "openai", harness: "native" },
        { id: "claude-only", provider: "anthropic", harness: "claude", costTier: "standard", featured: true },
      ],
    });
    expect(await bothDefaults(document)).toEqual({ runner: "gpt-untiered", server: "gpt-untiered" });
  });
});
