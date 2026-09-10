// Unit arms for the model-registry reader (entry 20260910.02): a document
// without a models array is refused by name — the runner degrades silently
// against one, and the arms must not — and a row lookup names the missing id.
// Pure. Domain: conformance harness (execution engine).
import { describe, expect, it } from "vitest";
import {
  economyRowFor,
  parseModelRegistryDocument,
  requireRegistryRow,
  wireModelIdOf,
  type ModelRegistryRow,
} from "../model-registry";

describe("parseModelRegistryDocument", () => {
  it("keeps id and apiModelId per row and drops rows without a string id", () => {
    const document = parseModelRegistryDocument({
      models: [
        { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", pricing: {} },
        { id: "no-api-id" },
        { apiModelId: "orphan" },
      ],
    });
    expect(document.models).toEqual([
      { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", provider: undefined, costTier: undefined, harness: undefined },
      { id: "no-api-id", apiModelId: undefined, provider: undefined, costTier: undefined, harness: undefined },
    ]);
  });

  it("refuses a document with no models array, naming the source", () => {
    expect(() => parseModelRegistryDocument({}, "http://x/v1/proxy/model-registry")).toThrow(
      /no models array/,
    );
    expect(() => parseModelRegistryDocument(null)).toThrow(/no models array/);
  });
});

const row = (id: string, extra: Partial<Omit<ModelRegistryRow, "id">> = {}): ModelRegistryRow => ({
  id,
  apiModelId: undefined,
  provider: undefined,
  costTier: undefined,
  harness: undefined,
  ...extra,
});

describe("requireRegistryRow", () => {
  it("returns the row for an id and names a missing one", () => {
    const document = { models: [row("a", { apiModelId: "a-1" })] };
    expect(requireRegistryRow(document, "a")).toEqual(row("a", { apiModelId: "a-1" }));
    expect(() => requireRegistryRow(document, "b")).toThrow(/no row with id "b" \(1 rows\)/);
  });
});

describe("economyRowFor", () => {
  const document = {
    models: [
      row("claude-sonnet-4.6", { provider: "anthropic", costTier: "standard", harness: "native" }),
      row("gpt-4o-mini", { provider: "openai", costTier: "economy", harness: "native", apiModelId: "gpt-4o-mini" }),
      row("claude-haiku-cursor", { provider: "anthropic", costTier: "economy", harness: "cursor" }),
      row("claude-haiku-4.5", { provider: "anthropic", costTier: "economy", harness: "native", apiModelId: "claude-haiku-4-5-20251001" }),
    ],
  };

  it("picks the first native economy row of the same provider, in the runner's order", () => {
    expect(economyRowFor(document, "anthropic").id).toBe("claude-haiku-4.5");
    expect(wireModelIdOf(economyRowFor(document, "anthropic"))).toBe("claude-haiku-4-5-20251001");
  });

  it("falls back to any native economy row when the provider has none, and names an empty registry", () => {
    expect(economyRowFor(document, "vertex").id).toBe("gpt-4o-mini");
    expect(() => economyRowFor({ models: [] }, "anthropic")).toThrow(/no economy-tier native row/);
    expect(wireModelIdOf(row("bare"))).toBe("bare");
  });
});
