/**
 * ValidateThinkingMode — fail-closed validation of the thinking mode a turn
 * will run with against the model registry (stigmer/stigmer#772), the
 * sibling of ValidateServiceTier for the second variant dimension, judged
 * on the engine the conversation runs on (stigmer/stigmer#1280).
 *
 * It judges the settings ResolveRunConfig resolved (status.run_config),
 * whichever layer chose them (resolve-run-config.ts). Unlike the fast tier,
 * thinking is capability-gated, not pricing-gated: thinking variants bill
 * at base per-token rates (ledger-verified), so the registry fact that
 * makes ENABLED selectable is a thinking capability on the model's entry
 * for the conversation's engine — `thinking` (a fixed budget) or
 * `adaptiveThinking` (depth adapts). Both engines translate the mode:
 * Cursor as its thinking variant, native as Anthropic's `thinking`
 * parameter in the form the entry declares. The engine scoping is what
 * keeps a selection honest: an id such as claude-sonnet-5 has an entry on
 * each engine, and only the entry the conversation runs on says what its
 * model does.
 *
 *   - UNSPECIFIED: always valid — it resolves to DISABLED in the runner,
 *     and a model that requires thinking thinks under it.
 *   - DISABLED: valid, except on a model whose entry declares
 *     `thinkingRequired` — it always thinks and the provider refuses a
 *     request to turn thinking off.
 *   - ENABLED: requires a model (Auto has no variant dimensions) whose
 *     entry on the engine declares a thinking capability.
 *
 * The engine is the one ResolveRunConfig placed the turn on: the stored
 * session's for a turn in an existing session (read behind the session's
 * run gate, so a refusal never tells an unauthorized caller which engine a
 * session uses), else the engine the new session will take. A refusal
 * names the layer that chose the mode and, when they differ, the one that
 * chose the model. It is a pure step, before any side effect.
 */
import type { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { invalidArgumentError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { ModelCatalogProvider } from "../workflow/registry/model-catalog-provider.js";
import {
  ADAPTIVE_THINKING_CAPABILITY_KEY,
  THINKING_CAPABILITY_KEY,
  THINKING_REQUIRED_CAPABILITY_KEY,
} from "../workflow/registry/model-registry-store.js";
import { canThinkOn } from "../workflow/registry/run-config-checks.js";

import {
  runConfigLayerName,
  runConfigPlacementOf,
  type RunConfigPlacement,
} from "./resolve-run-config.js";
import { modelFromClause } from "./validate-service-tier.js";

export function newValidateThinkingModeStep(
  registry: ModelCatalogProvider,
): PipelineStep<typeof AgentExecutionSchema> {
  return {
    name: "ValidateThinkingMode",
    execute(ctx) {
      const placement = runConfigPlacementOf(ctx);
      if (placement === undefined) {
        return;
      }
      const refusal = thinkingModeRefusal(registry, placement);
      if (refusal !== "") {
        throw invalidArgumentError(refusal);
      }
    },
  };
}

/** The refusal copy for the placement's resolved thinking mode, or "" when it is valid. */
export function thinkingModeRefusal(
  registry: ModelCatalogProvider,
  placement: RunConfigPlacement,
): string {
  const { config, chosenBy } = placement.resolution;
  const mode = config.thinkingMode;
  const modelName = config.modelName;
  // UNSPECIFIED is always valid, and so is DISABLED on Auto (no model to
  // require thinking). Unknown enum numbers were already refused by proto
  // field validation (defined_only).
  if (mode === ThinkingMode.UNSPECIFIED || (mode === ThinkingMode.DISABLED && modelName === "")) {
    return "";
  }
  const harness = placement.harness;
  const modeFrom = runConfigLayerName(placement, chosenBy.thinkingMode);
  const modelFrom = modelFromClause(placement, chosenBy.thinkingMode);

  if (mode === ThinkingMode.DISABLED) {
    if (registry.hasCapabilityForHarness(harness, modelName, THINKING_REQUIRED_CAPABILITY_KEY)) {
      return (
        `thinking_mode 'disabled' (from ${modeFrom}) is not available for model ` +
        `'${modelName}'${modelFrom}: the model always thinks on the ${harness} harness and ` +
        "refuses a request to turn thinking off. Leave thinking_mode unset, or set it to 'enabled'."
      );
    }
    return "";
  }

  if (modelName === "") {
    return (
      `thinking_mode 'enabled' (from ${modeFrom}) requires a model_name: thinking is a ` +
      "per-model capability, and Auto (no pinned model) has no variant dimensions. " +
      `Pin a model that supports it${thinkingCapableSuffix(registry, harness)}.`
    );
  }

  if (!canThinkOn(registry, harness, modelName)) {
    return (
      `thinking_mode 'enabled' (from ${modeFrom}) is not available for model ` +
      `'${modelName}'${modelFrom}: the model registry declares no thinking capability ` +
      `for it on the ${harness} harness${thinkingCapableSuffix(registry, harness)}.`
    );
  }
  return "";
}

/**
 * "; models with a thinking mode: a, b, c" — actionable refusal detail for
 * the harness, sorted, empty when the registry declares none there.
 */
function thinkingCapableSuffix(registry: ModelCatalogProvider, harness: string): string {
  const capable = [
    ...new Set([
      ...registry.canonicalModelsWithCapabilityForHarness(harness, THINKING_CAPABILITY_KEY),
      ...registry.canonicalModelsWithCapabilityForHarness(harness, ADAPTIVE_THINKING_CAPABILITY_KEY),
    ]),
  ].sort();
  if (capable.length === 0) {
    return "";
  }
  return `; models with a thinking mode: ${capable.join(", ")}`;
}
