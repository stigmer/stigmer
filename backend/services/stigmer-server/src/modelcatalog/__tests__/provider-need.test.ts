/**
 * The provider rule (provider-need.ts) over every engine: Cursor needs
 * Cursor whatever the model, Claude needs Anthropic and names the engine's
 * default when the turn names none, native needs its model's provider
 * from the catalog (an entry's, or an explicit prefix) and nothing when
 * that provider is no key slot, Cursor's own included. The catalog is a
 * fixed fake so each arm reads one answer.
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
  native: {
    "claude-sonnet-4.6": "anthropic",
    "gpt-5.2": "openai",
    "gemini-3-pro": "google",
    "composer-2": "cursor",
  },
};

const catalog: ProviderNeedCatalog = {
  providerOf: (harness, model) => {
    if (model.startsWith("openai:")) return "openai";
    if (model.startsWith("anthropic:")) return "anthropic";
    return PROVIDERS[harness]?.[model];
  },
  defaultModel: (harness) => ({ native: "claude-sonnet-4.6", claude: "claude-opus-4.8" })[harness],
};

describe("providerNeededBy", () => {
  it("a Cursor turn needs Cursor, whatever its model, and names the model it was given", () => {
    expect(providerNeededBy(Harness.CURSOR, "gpt-5.2", catalog)).toEqual({ provider: "cursor", model: "gpt-5.2" });
    expect(providerNeededBy(Harness.CURSOR, "", catalog)).toEqual({ provider: "cursor", model: "" });
  });

  it("a Claude turn needs Anthropic, naming the engine's default when the turn names no model", () => {
    expect(providerNeededBy(Harness.CLAUDE, "claude-sonnet-4.6", catalog)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4.6",
    });
    expect(providerNeededBy(Harness.CLAUDE, "", catalog)).toEqual({ provider: "anthropic", model: "claude-opus-4.8" });
    expect(providerNeededBy(Harness.CLAUDE, "", { ...catalog, defaultModel: () => undefined })).toEqual({
      provider: "anthropic",
      model: "",
    });
  });

  it("a native turn needs its model's provider, or the default model's, on native and unspecified alike", () => {
    expect(providerNeededBy(Harness.NATIVE, "gpt-5.2", catalog)).toEqual({ provider: "openai", model: "gpt-5.2" });
    expect(providerNeededBy(Harness.UNSPECIFIED, "", catalog)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4.6",
    });
    expect(providerNeededBy(Harness.NATIVE, "openai:my-model", catalog)).toEqual({
      provider: "openai",
      model: "openai:my-model",
    });
  });

  it("a native model whose provider is no key slot, is Cursor's, or is unknown needs nothing judged", () => {
    expect(providerNeededBy(Harness.NATIVE, "gemini-3-pro", catalog)).toBeUndefined();
    expect(providerNeededBy(Harness.NATIVE, "composer-2", catalog)).toBeUndefined();
    expect(providerNeededBy(Harness.NATIVE, "no-such-model", catalog)).toBeUndefined();
    expect(providerNeededBy(Harness.NATIVE, "", { ...catalog, defaultModel: () => undefined })).toBeUndefined();
  });
});

describe("the provider list", () => {
  it("names the three key slots in report order", () => {
    expect(MODEL_PROVIDERS).toEqual(["anthropic", "openai", "cursor"]);
    expect(isModelProvider("openai")).toBe(true);
    expect(isModelProvider("google")).toBe(false);
  });
});
