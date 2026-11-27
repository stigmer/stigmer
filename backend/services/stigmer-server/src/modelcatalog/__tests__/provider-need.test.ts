/**
 * The provider rule (provider-need.ts) over every engine: Claude needs
 * Anthropic whatever the model and names the engine's default when the
 * turn names none, Stigmer needs its model's provider from the catalog (an
 * entry's, or an explicit prefix) and nothing when that provider is no key
 * slot. The catalog is a fixed fake so each arm reads one answer. The
 * provider list is held equal to the key contract's own list of providers
 * (billing/providerkey/v1, read from its generated descriptor), so a
 * provider added to one and not the other fails here.
 */
import { type DescMessage, getOption } from "@bufbuild/protobuf";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import {
  DeleteProviderKeyInputSchema,
  SetProviderKeyInputSchema,
} from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/io_pb";
import { field } from "@stigmer/apis/buf/validate/validate_pb";
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
    "mistral-large": "mistral",
  },
};

const catalog: ProviderNeedCatalog = {
  providerOf: (harness, model) => {
    if (model.startsWith("openai:")) return "openai";
    if (model.startsWith("anthropic:")) return "anthropic";
    if (model.startsWith("google:")) return "google";
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

  it("a Stigmer turn needs its model's provider, or the default model's, on Stigmer and unspecified alike", () => {
    expect(providerNeededBy(Harness.STIGMER, "gpt-5.2", catalog)).toEqual({ provider: "openai", model: "gpt-5.2" });
    expect(providerNeededBy(Harness.UNSPECIFIED, "", catalog)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4.6",
    });
    expect(providerNeededBy(Harness.STIGMER, "openai:my-model", catalog)).toEqual({
      provider: "openai",
      model: "openai:my-model",
    });
    expect(providerNeededBy(Harness.STIGMER, "gemini-3-pro", catalog)).toEqual({
      provider: "google",
      model: "gemini-3-pro",
    });
    expect(providerNeededBy(Harness.STIGMER, "google:gemini-4-hydrogen", catalog)).toEqual({
      provider: "google",
      model: "google:gemini-4-hydrogen",
    });
  });

  it("a Stigmer-harness model whose provider is no key slot or is unknown needs nothing judged", () => {
    expect(providerNeededBy(Harness.STIGMER, "mistral-large", catalog)).toBeUndefined();
    expect(providerNeededBy(Harness.STIGMER, "no-such-model", catalog)).toBeUndefined();
    expect(providerNeededBy(Harness.STIGMER, "", { ...catalog, defaultModel: () => undefined })).toBeUndefined();
  });
});

/** The providers a key contract input's `provider` field accepts, in its order. */
function contractProviders(schema: DescMessage): readonly string[] {
  const provider = schema.fields.find((f) => f.name === "provider");
  if (provider === undefined) throw new Error(`${schema.typeName} has no provider field`);
  const rules = getOption(provider, field);
  if (rules.type.case !== "string") throw new Error(`${schema.typeName}.provider has no string rules`);
  return rules.type.value.in;
}

describe("the provider list", () => {
  it("names the three key slots in report order", () => {
    expect(MODEL_PROVIDERS).toEqual(["anthropic", "openai", "google"]);
    expect(isModelProvider("openai")).toBe(true);
    expect(isModelProvider("google")).toBe(true);
    expect(isModelProvider("cursor")).toBe(false);
    // The provider is google on the wire; a Gemini key is saved under it.
    expect(isModelProvider("gemini")).toBe(false);
  });

  it("is the key contract's list, in its order, on set and on delete alike", () => {
    expect(contractProviders(SetProviderKeyInputSchema)).toEqual([...MODEL_PROVIDERS]);
    expect(contractProviders(DeleteProviderKeyInputSchema)).toEqual([...MODEL_PROVIDERS]);
  });
});
