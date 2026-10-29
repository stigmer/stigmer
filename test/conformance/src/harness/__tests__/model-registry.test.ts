// Unit arms for the model-registry reader: a document
// without a models array is refused by name — the runner degrades silently
// against one, and the arms must not — a row lookup names the missing id, and
// a row is priced only when it carries a pricing object.
// Pure. Domain: conformance harness (execution engine).
import { describe, expect, it } from "vitest";
import {
  economyRowFor,
  parseModelRegistryDocument,
  requireStigmerRow,
  requireRegistryRow,
  wireModelIdOf,
  type ModelRegistryRow,
} from "../model-registry";

const row = (id: string, extra: Partial<Omit<ModelRegistryRow, "id">> = {}): ModelRegistryRow => ({
  id,
  apiModelId: undefined,
  provider: undefined,
  costTier: undefined,
  harness: undefined,
  maxOutputTokens: undefined,
  thinkingForm: "none",
  thinkingRequired: undefined,
  priced: false,
  ...extra,
});

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
      row("claude-haiku-4.5", { apiModelId: "claude-haiku-4-5-20251001", priced: true }),
      row("no-api-id"),
    ]);
  });

  it("marks a row priced only when it carries a pricing object, the rows the runner prices from", () => {
    const document = parseModelRegistryDocument({
      models: [
        { id: "priced", pricing: { inputPricePerMillion: 3 } },
        { id: "null-pricing", pricing: null },
        { id: "no-pricing" },
      ],
    });
    expect(document.models.map((model) => [model.id, model.priced])).toEqual([
      ["priced", true],
      ["null-pricing", false],
      ["no-pricing", false],
    ]);
  });

  it("reads the Stigmer harness's request facts: the ceiling, the thinking form and the tri-state required flag", () => {
    const document = parseModelRegistryDocument({
      models: [
        { id: "adaptive", maxOutputTokens: 128000, capabilities: { thinking: false, adaptiveThinking: true, thinkingRequired: true } },
        { id: "budget", maxOutputTokens: 64000, capabilities: { thinking: true, adaptiveThinking: false, thinkingRequired: false } },
        { id: "unassessed", maxOutputTokens: "64000", capabilities: { thinking: false, adaptiveThinking: false } },
        { id: "no-block" },
      ],
    });
    expect(document.models).toEqual([
      row("adaptive", { maxOutputTokens: 128000, thinkingForm: "adaptive", thinkingRequired: true }),
      row("budget", { maxOutputTokens: 64000, thinkingForm: "budget", thinkingRequired: false }),
      row("unassessed"),
      row("no-block"),
    ]);
  });

  it("refuses a document with no models array, naming the source", () => {
    expect(() => parseModelRegistryDocument({}, "http://x/v1/proxy/model-registry")).toThrow(
      /no models array/,
    );
    expect(() => parseModelRegistryDocument(null)).toThrow(/no models array/);
  });
});


describe("requireRegistryRow", () => {
  it("returns the row for an id and names a missing one", () => {
    const document = { models: [row("a", { apiModelId: "a-1" })] };
    expect(requireRegistryRow(document, "a")).toEqual(row("a", { apiModelId: "a-1" }));
    expect(() => requireRegistryRow(document, "b")).toThrow(/no row with id "b" \(1 rows\)/);
  });
});

describe("requireStigmerRow", () => {
  it("returns the Stigmer harness's row of an id that has one on each harness, and names a missing one", () => {
    const document = {
      models: [
        row("claude-sonnet-5", { harness: "claude" }),
        row("claude-sonnet-5", { harness: "stigmer", maxOutputTokens: 128000 }),
        row("claude-only-5", { harness: "claude" }),
      ],
    };
    expect(requireStigmerRow(document, "claude-sonnet-5").maxOutputTokens).toBe(128000);
    expect(() => requireStigmerRow(document, "claude-only-5")).toThrow(/no Stigmer row with id "claude-only-5"/);
  });
});

describe("economyRowFor", () => {
  const document = {
    models: [
      row("claude-sonnet-4.6", { provider: "anthropic", costTier: "standard", harness: "stigmer" }),
      row("gpt-4o-mini", { provider: "openai", costTier: "economy", harness: "stigmer", apiModelId: "gpt-4o-mini" }),
      row("claude-haiku-engine", { provider: "anthropic", costTier: "economy", harness: "claude" }),
      row("claude-haiku-4.5", { provider: "anthropic", costTier: "economy", harness: "stigmer", apiModelId: "claude-haiku-4-5-20251001" }),
    ],
  };

  it("picks the first Stigmer economy row of the same provider, in the runner's order", () => {
    expect(economyRowFor(document, "anthropic").id).toBe("claude-haiku-4.5");
    expect(wireModelIdOf(economyRowFor(document, "anthropic"))).toBe("claude-haiku-4-5-20251001");
  });

  it("falls back to any Stigmer economy row when the provider has none, and names an empty registry", () => {
    expect(economyRowFor(document, "vertex").id).toBe("gpt-4o-mini");
    expect(() => economyRowFor({ models: [] }, "anthropic")).toThrow(/no economy-tier Stigmer row/);
    expect(wireModelIdOf(row("bare"))).toBe("bare");
  });
});
