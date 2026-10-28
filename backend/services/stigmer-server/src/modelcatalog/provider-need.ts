/**
 * Which model provider a turn needs: the one rule every edition's answer
 * to "can this model run here?" and its refusal at create read.
 *
 * A provider is named by the wire protocol its key speaks, the names
 * provider keys are saved under (billing/providerkey/v1): "anthropic",
 * "openai" and "cursor". {@link MODEL_PROVIDERS} is the one list and its
 * order is the order every answer reports them in; a provider joins or
 * leaves by an entry here, and every table typed over it fails to compile
 * until it says what it does with the change.
 *
 * The provider follows the engine the turn runs on:
 *   - a Cursor turn needs Cursor, whatever its model (Cursor's own servers
 *     run the model, on the Cursor key);
 *   - a Claude turn needs Anthropic: the engine runs Claude models only;
 *   - a native turn needs its model's provider, read from the catalog
 *     (`providerOf`: a catalog entry's provider, or an `anthropic:` or
 *     `openai:` prefix), the model being the one the turn names, else the
 *     one the runner will default to. A native model whose provider is no
 *     key slot (or that the catalog cannot place) needs nothing this rule
 *     can judge: the runner, and on the cloud the metered proxy, answer for
 *     it.
 * A turn that runs no model (a file review's Undo, `reconcile_file_review`)
 * needs nothing; the run step asks that before the rule.
 *
 * Proven by __tests__/provider-need.test.ts.
 */
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import type { ModelCatalogProvider } from "./model-catalog-provider.js";
import { harnessName } from "./pin-validation.js";

/** Every model provider, in the order every answer reports them. */
export const MODEL_PROVIDERS = ["anthropic", "openai", "cursor"] as const;

/** A model provider's name. */
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

/** Each provider's name as people read it, keyed by every provider. */
export const MODEL_PROVIDER_LABELS: Readonly<Record<ModelProvider, string>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  cursor: "Cursor",
};

/** Whether `name` is one of {@link MODEL_PROVIDERS}. */
export function isModelProvider(name: string): name is ModelProvider {
  return (MODEL_PROVIDERS as readonly string[]).includes(name);
}

/** The provider a turn needs, and the model a refusal names (empty when the turn names none, as a Cursor turn on Auto does). */
export interface ProviderNeed {
  readonly provider: ModelProvider;
  readonly model: string;
}

/** What the rule reads from the catalog. */
export type ProviderNeedCatalog = Pick<ModelCatalogProvider, "providerOf" | "defaultModel">;

/**
 * The provider a turn on `engine` naming `model` ("" for none) needs, or
 * undefined when it needs none this rule can judge.
 */
export function providerNeededBy(
  engine: Harness,
  model: string,
  catalog: ProviderNeedCatalog,
): ProviderNeed | undefined {
  switch (engine) {
    case Harness.CURSOR:
      return { provider: "cursor", model };
    case Harness.CLAUDE:
      return {
        provider: "anthropic",
        model: model !== "" ? model : (catalog.defaultModel(harnessName(Harness.CLAUDE)) ?? ""),
      };
    case Harness.NATIVE:
    case Harness.UNSPECIFIED: {
      const section = harnessName(Harness.NATIVE);
      const resolved = model !== "" ? model : catalog.defaultModel(section);
      if (resolved === undefined) {
        return undefined;
      }
      const provider = catalog.providerOf(section, resolved);
      // A native turn's calls never go to Cursor, so a Cursor key serves none.
      if (provider === undefined || !isModelProvider(provider) || provider === "cursor") {
        return undefined;
      }
      return { provider, model: resolved };
    }
    default: {
      const unknown: never = engine;
      return unknown;
    }
  }
}
