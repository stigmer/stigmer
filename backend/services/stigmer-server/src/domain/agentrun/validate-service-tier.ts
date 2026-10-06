/**
 * ValidateServiceTier — fail-closed validation of the service tier a turn
 * will run with against the model registry (stigmer/stigmer#357).
 *
 * The tier exists to make pricing deterministic, so it is validated where
 * the price is decided — at create, against the current registry — never
 * discovered as a silent no-op at run time. It judges the settings
 * ResolveRunConfig resolved (status.run_config), whichever layer chose
 * them, so a tier saved on a surface or an agent is judged exactly as one a
 * person sends (resolve-run-config.ts). The rule is a pure function of
 * (model_name, service_tier, the conversation's engine, registry):
 *
 *   - UNSPECIFIED / STANDARD: always valid — every model has a
 *     base-priced configuration, and unset resolves to
 *     explicitly-requested STANDARD in the runner (never the provider
 *     account default).
 *   - FAST: requires a model (Auto has no tier dimension) whose registry
 *     entry on the engine the conversation runs prices a "fast" variant: a
 *     fast price listed under the other engine would select a tier this
 *     turn can never apply. A tier the registry cannot price
 *     would trip billing's undercharge guard — selection and billability
 *     are coupled by construction.
 *
 * A refusal names the layer that chose the tier and, when they differ, the
 * one that chose the model. Positioned directly after ResolveRunConfig,
 * behind the run gate and before any side-effecting step. Every edition
 * refuses the same request with the same message (pinned by the
 * conformance tier suite, which runs against every target).
 */
import type { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { ServiceTier } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";

import { invalidArgumentError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { ModelCatalogProvider } from "../workflow/registry/model-catalog-provider.js";
import { FAST_VARIANT_KEY } from "../workflow/registry/model-registry-store.js";

import {
  runConfigLayerName,
  runConfigPlacementOf,
  type RunConfigLayer,
  type RunConfigPlacement,
} from "./resolve-run-config.js";

export function newValidateServiceTierStep(
  registry: ModelCatalogProvider,
): PipelineStep<typeof AgentRunSchema> {
  return {
    name: "ValidateServiceTier",
    execute(ctx) {
      const placement = runConfigPlacementOf(ctx);
      if (placement === undefined) {
        return;
      }
      const refusal = serviceTierRefusal(registry, placement);
      if (refusal !== "") {
        throw invalidArgumentError(refusal);
      }
    },
  };
}

/** The refusal copy for the placement's resolved tier, or "" when it is valid. */
export function serviceTierRefusal(
  registry: ModelCatalogProvider,
  placement: RunConfigPlacement,
): string {
  const { config, chosenBy } = placement.resolution;
  if (config.serviceTier !== ServiceTier.FAST) {
    // UNSPECIFIED and STANDARD are always valid; unknown enum numbers
    // were already refused by proto field validation (defined_only).
    return "";
  }
  const tierFrom = runConfigLayerName(placement, chosenBy.serviceTier);
  if (config.modelName === "") {
    return (
      `service_tier 'fast' (from ${tierFrom}) requires a model_name: the fast tier is a ` +
      "per-model price, and Auto (no pinned model) has no tier dimension. " +
      `Pin a model that supports it${fastCapableSuffix(registry, placement.harness)}.`
    );
  }
  const harness = placement.harness;
  if (!registry.hasPricingVariantForHarness(harness, config.modelName, FAST_VARIANT_KEY)) {
    return (
      `service_tier 'fast' (from ${tierFrom}) is not available for model ` +
      `'${config.modelName}'${modelFromClause(placement, chosenBy.serviceTier)}: the model registry prices no ` +
      `fast variant for it on the ${harness} harness${fastCapableSuffix(registry, harness)}.`
    );
  }
  return "";
}

/** " (from <layer>)" when the model came from another layer than the judged choice, else "". */
export function modelFromClause(
  placement: RunConfigPlacement,
  choiceLayer: RunConfigLayer | undefined,
): string {
  const modelLayer = placement.resolution.chosenBy.model;
  return modelLayer === choiceLayer
    ? ""
    : ` (from ${runConfigLayerName(placement, modelLayer)})`;
}

/**
 * "; models with a fast tier: a, b, c" — actionable refusal detail for the
 * harness, sorted (the store keeps the list sorted), empty when the
 * registry prices none there.
 */
function fastCapableSuffix(registry: ModelCatalogProvider, harness: string): string {
  const capable = registry.canonicalModelsWithVariantForHarness(harness, FAST_VARIANT_KEY);
  if (capable.length === 0) {
    return "";
  }
  return `; models with a fast tier: ${capable.join(", ")}`;
}
