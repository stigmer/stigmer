/**
 * The provider rule (provider-need.ts) over every engine: Claude needs
 * Anthropic whatever the model and names the engine's default when the
 * turn names none, native needs its model's provider from the catalog (an
 * entry's, or an explicit prefix) and nothing when that provider is no key
 * slot. The catalog is a fixed fake so each arm reads one answer.
 */
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { describe, expect, it } from "vitest";

import {
  MODEL_PROVIDERS,
  isModelProvider,
  providerNeededBy,
  type ProviderNeedCatalog,
} from "../provider-need.js";

const PROVIDERS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  stigmer: {
    "claude-sonnet-4.6": "anthropic",
    "gpt-5.2": "openai",
    "gemini-3-pro": "google",
  },
};

const catalog: ProviderNeedCatalog = {
  providerOf: (harness, model) => {
    if (model.startsWith("openai:")) return "openai";
    if (model.startsWith("anthropic:")) return "anthropic";
    return PROVIDERS[harness]?.[model];
  },
  defaultModel: (harness) => ({ stigmer: "claude-sonnet-4.6", claude: "claude-opus-4.8" })[harness],
};

describe("providerNeededBy", () => {
  it("a Claude turn needs Anthropic, whatever its model, naming the engine's default when the turn names no model", () => {
    expect(providerNeededBy(Harness.CLAUDE, "claude-sonnet-4.6", catalog)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4.6",
    });
    expect(providerNeededBy(Harness.CLAUDE, "gpt-5.2", catalog)).toEqual({ provider: "anthropic", model: "gpt-5.2" });
    expect(providerNeededBy(Harness.CLAUDE, "", catalog)).toEqual({ provider: "anthropic", model: "claude-opus-4.8" });
    expect(providerNeededBy(Harness.CLAUDE, "", { ...catalog, defaultModel: () => undefined })).toEqual({
      provider: "anthropic",
      model: "",
    });
  });

  it("a native turn needs its model's provider, or the default model's, on native and unspecified alike", () => {
    expect(providerNeededBy(Harness.STIGMER, "gpt-5.2", catalog)).toEqual({ provider: "openai", model: "gpt-5.2" });
    expect(providerNeededBy(Harness.UNSPECIFIED, "", catalog)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4.6",
    });
    expect(providerNeededBy(Harness.STIGMER, "openai:my-model", catalog)).toEqual({
      provider: "openai",
      model: "openai:my-model",
    });
  });

  it("a native model whose provider is no key slot or is unknown needs nothing judged", () => {
    expect(providerNeededBy(Harness.STIGMER, "gemini-3-pro", catalog)).toBeUndefined();
    expect(providerNeededBy(Harness.STIGMER, "no-such-model", catalog)).toBeUndefined();
    expect(providerNeededBy(Harness.STIGMER, "", { ...catalog, defaultModel: () => undefined })).toBeUndefined();
  });
});

describe("the provider list", () => {
  it("names the two key slots in report order", () => {
    expect(MODEL_PROVIDERS).toEqual(["anthropic", "openai"]);
    expect(isModelProvider("openai")).toBe(true);
    expect(isModelProvider("cursor")).toBe(false);
    expect(isModelProvider("google")).toBe(false);
  });
});
