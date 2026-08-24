/**
 * ValidateServiceTier — ports validate_service_tier.go: fail-closed
 * validation of ExecutionConfig.service_tier against the model registry
 * (stigmer/stigmer#357).
 *
 * The tier exists to make pricing deterministic, so it is validated where
 * the price is decided — at create, against the current registry — never
 * discovered as a silent no-op at run time. The rule is a pure function
 * of (model_name, service_tier, registry):
 *
 *   - UNSPECIFIED / STANDARD: always valid — every model has a
 *     base-priced configuration, and unset resolves to
 *     explicitly-requested STANDARD in the runner (never the provider
 *     account default).
 *   - FAST: requires model_name to be set (Auto has no tier dimension)
 *     and that model's registry entry to price a "fast" variant. A tier
 *     the registry cannot price would trip billing's undercharge guard —
 *     selection and billability are coupled by construction.
 *
 * Positioned directly after proto validation, before any side-effecting
 * step. Mirrors the cloud Java ValidateServiceTierStep; all THREE
 * editions must refuse the same request with the same message (pinned by
 * the conformance tier suite, which runs against every target).
 */
import type { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ServiceTier } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { invalidArgumentError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import {
  FAST_VARIANT_KEY,
  type ModelRegistryStore,
} from "../workflow/registry/model-registry-store.js";

export function newValidateServiceTierStep(
  registry: ModelRegistryStore,
): PipelineStep<typeof AgentExecutionSchema> {
  return {
    name: "ValidateServiceTier",
    execute(ctx) {
      const config = ctx.newState.spec?.executionConfig;
      if (config?.serviceTier !== ServiceTier.FAST) {
        // UNSPECIFIED and STANDARD are always valid; unknown enum numbers
        // were already refused by proto field validation (defined_only).
        return;
      }

      const modelName = (config.modelName ?? "").trim();
      if (modelName === "") {
        throw invalidArgumentError(
          "service_tier 'fast' requires execution_config.model_name: the fast tier is a " +
            "per-model price, and Auto (no pinned model) has no tier dimension. " +
            `Pin a model that supports it${fastCapableSuffix(registry)}.`,
        );
      }

      if (!registry.hasPricingVariant(modelName, FAST_VARIANT_KEY)) {
        throw invalidArgumentError(
          `service_tier 'fast' is not available for model '${modelName}': the model ` +
            `registry prices no fast variant for it${fastCapableSuffix(registry)}.`,
        );
      }
    },
  };
}

/**
 * "; models with a fast tier: a, b, c" — actionable refusal detail,
 * sorted (the store keeps the list sorted), empty when the registry
 * prices none.
 */
function fastCapableSuffix(registry: ModelRegistryStore): string {
  const capable = registry.canonicalModelsWithVariant(FAST_VARIANT_KEY);
  if (capable.length === 0) {
    return "";
  }
  return `; models with a fast tier: ${capable.join(", ")}`;
}
