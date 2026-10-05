/**
 * The save-time checks of a saved RunConfig's speed tier and thinking mode,
 * judged on the engine the saved settings name: a workflow agent_call
 * step's run_config against its task harness, and an agent's run defaults
 * against AgentSpec.harness. One copy, so a step and an agent refuse the
 * same settings with the same sentence.
 *
 * Saved settings are self-contained (RunConfig's contract): a saved FAST or
 * ENABLED names the model it is for, so it is refused without a model here,
 * where a live message may set either alone to adjust the model another
 * layer chose. The engine scoping is what keeps a save honest: a fast price
 * or a thinking capability listed under the other engine would validate a
 * setting the turn can never apply (a silent no-op, the class #357 exists
 * to kill). A thinking capability is either form the registry declares
 * (`thinking`, a fixed budget, or `adaptiveThinking`), as at execution
 * create.
 *
 * STANDARD, DISABLED and unset are always valid here; unknown enum values
 * never reach these functions (proto validation and strict task-config
 * unmarshaling refuse them first).
 */
import { ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { RunConfig } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/invocation_pb";

import type { ModelCatalogProvider } from "./model-catalog-provider.js";
import {
  ADAPTIVE_THINKING_CAPABILITY_KEY,
  FAST_VARIANT_KEY,
  THINKING_CAPABILITY_KEY,
} from "./model-registry-store.js";

/** Where a refusal places the saved settings: a sentence prefix and the settings' field path. */
export interface SavedRunConfigSite {
  /** Leads the refusal, e.g. "task 'review' (agent_call): ", or "". */
  readonly prefix: string;
  /** The saved settings' field path, e.g. "run_config" or "spec.run_config". */
  readonly fieldPath: string;
}

/** The refusal copy for a saved FAST tier, or "" when it is valid. */
export function savedServiceTierRefusal(
  models: ModelCatalogProvider,
  site: SavedRunConfigSite,
  harness: string,
  rc: RunConfig | undefined,
): string {
  if (rc?.serviceTier !== ServiceTier.FAST) {
    return "";
  }
  const { prefix, fieldPath } = site;
  const modelName = rc.modelName.trim();
  if (modelName === "") {
    return (
      `${prefix}${fieldPath}.service_tier 'fast' requires ` +
      `${fieldPath}.model_name — the fast tier is a per-model price`
    );
  }
  if (!models.hasPricingVariantForHarness(harness, modelName, FAST_VARIANT_KEY)) {
    return (
      `${prefix}${fieldPath}.service_tier 'fast' is not available ` +
      `for model '${modelName}' on harness '${harness}': the model registry prices no fast ` +
      `variant for it${fastCapableSuffix(models, harness)}`
    );
  }
  return "";
}

/** The refusal copy for a saved ENABLED thinking mode, or "" when it is valid. */
export function savedThinkingModeRefusal(
  models: ModelCatalogProvider,
  site: SavedRunConfigSite,
  harness: string,
  rc: RunConfig | undefined,
): string {
  if (rc?.thinkingMode !== ThinkingMode.ENABLED) {
    return "";
  }
  const { prefix, fieldPath } = site;
  const modelName = rc.modelName.trim();
  if (modelName === "") {
    return (
      `${prefix}${fieldPath}.thinking_mode 'enabled' requires ` +
      `${fieldPath}.model_name — thinking is a per-model capability`
    );
  }
  if (!canThinkOn(models, harness, modelName)) {
    return (
      `${prefix}${fieldPath}.thinking_mode 'enabled' is not available ` +
      `for model '${modelName}' on harness '${harness}': the model registry declares no thinking ` +
      `capability for it${thinkingCapableSuffix(models, harness)}`
    );
  }
  return "";
}

/** Whether the model's entry on the harness declares either thinking capability. */
export function canThinkOn(
  models: ModelCatalogProvider,
  harness: string,
  modelName: string,
): boolean {
  return (
    models.hasCapabilityForHarness(harness, modelName, THINKING_CAPABILITY_KEY) ||
    models.hasCapabilityForHarness(harness, modelName, ADAPTIVE_THINKING_CAPABILITY_KEY)
  );
}

/**
 * "; models with a thinking mode on '<harness>': a, b, c" — sorted, empty
 * when the registry declares none for that harness.
 */
function thinkingCapableSuffix(
  models: ModelCatalogProvider,
  harness: string,
): string {
  const capable = [
    ...new Set([
      ...models.canonicalModelsWithCapabilityForHarness(harness, THINKING_CAPABILITY_KEY),
      ...models.canonicalModelsWithCapabilityForHarness(harness, ADAPTIVE_THINKING_CAPABILITY_KEY),
    ]),
  ].sort();
  if (capable.length === 0) {
    return "";
  }
  return `; models with a thinking mode on '${harness}': ${capable.join(", ")}`;
}

/**
 * "; models with a fast tier on '<harness>': a, b, c" — sorted, empty when
 * the registry prices none for that harness.
 */
function fastCapableSuffix(
  models: ModelCatalogProvider,
  harness: string,
): string {
  const capable = models.canonicalModelsWithVariantForHarness(
    harness,
    FAST_VARIANT_KEY,
  );
  if (capable.length === 0) {
    return "";
  }
  return `; models with a fast tier on '${harness}': ${capable.join(", ")}`;
}
