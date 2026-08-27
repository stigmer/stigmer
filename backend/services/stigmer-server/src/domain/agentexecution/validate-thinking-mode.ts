/**
 * ValidateThinkingMode — ports validate_thinking_mode.go: fail-closed
 * validation of ExecutionConfig.thinking_mode against the model registry
 * (stigmer/stigmer#772) — the sibling of ValidateServiceTier for the
 * second variant dimension.
 *
 * Unlike the fast tier, thinking is capability-gated, not pricing-gated:
 * thinking variants bill at base per-token rates (ledger-verified), so
 * the registry fact that makes ENABLED selectable is
 * capabilities.thinking on the model's CURSOR-harness entry. The harness
 * scoping is deliberate — native entries truthfully declare the same
 * capability (Anthropic models support extended thinking natively) but no
 * native wire mapping exists in v1, so validating them would accept a
 * config the runner silently cannot honor (the exact silent-no-op class
 * #357 exists to kill; mirrors the #361 FAST-on-native hold).
 *
 *   - UNSPECIFIED / DISABLED: always valid — every model has a base
 *     variant, and unset resolves to explicitly-requested DISABLED in the
 *     runner (never the provider account default).
 *   - ENABLED: requires model_name to be set (Auto has no variant
 *     dimensions) and that model's cursor-harness registry entry to
 *     declare the thinking capability.
 *
 * Positioned beside ValidateServiceTier, before any side-effecting step.
 * Mirrors the cloud Java ValidateThinkingModeStep; all three editions
 * must refuse the same request with the same message.
 */
import type { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { invalidArgumentError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { ModelCatalogProvider } from "../workflow/registry/model-catalog-provider.js";
import { THINKING_CAPABILITY_KEY } from "../workflow/registry/model-registry-store.js";
import { HARNESS_NAME_CURSOR } from "../workflow/registry/pin-validation.js";

export function newValidateThinkingModeStep(
  registry: ModelCatalogProvider,
): PipelineStep<typeof AgentExecutionSchema> {
  return {
    name: "ValidateThinkingMode",
    execute(ctx) {
      const config = ctx.newState.spec?.executionConfig;
      if (config?.thinkingMode !== ThinkingMode.ENABLED) {
        // UNSPECIFIED and DISABLED are always valid; unknown enum numbers
        // were already refused by proto field validation (defined_only).
        return;
      }

      const modelName = (config.modelName ?? "").trim();
      if (modelName === "") {
        throw invalidArgumentError(
          "thinking_mode 'enabled' requires execution_config.model_name: thinking is a " +
            "per-model capability, and Auto (no pinned model) has no variant dimensions. " +
            `Pin a model that supports it${thinkingCapableSuffix(registry)}.`,
        );
      }

      if (
        !registry.hasCapabilityForHarness(
          HARNESS_NAME_CURSOR,
          modelName,
          THINKING_CAPABILITY_KEY,
        )
      ) {
        throw invalidArgumentError(
          `thinking_mode 'enabled' is not available for model '${modelName}': the model ` +
            "registry declares no thinking capability for it on the cursor " +
            `harness${thinkingCapableSuffix(registry)}.`,
        );
      }
    },
  };
}

/**
 * "; models with a thinking mode: a, b, c" — actionable refusal detail,
 * sorted (the store keeps the list sorted), empty when the registry
 * declares none.
 */
function thinkingCapableSuffix(registry: ModelCatalogProvider): string {
  const capable = registry.canonicalModelsWithCapabilityForHarness(
    HARNESS_NAME_CURSOR,
    THINKING_CAPABILITY_KEY,
  );
  if (capable.length === 0) {
    return "";
  }
  return `; models with a thinking mode: ${capable.join(", ")}`;
}
