/**
 * Harness-aware model-reference validation — ports
 * pkg/domain/workflow/validation/model_validation.go.
 *
 * Model validity comes from the composed ModelCatalogProvider (DD-008) —
 * the same document the /v1/proxy/model-registry HTTP lane serves. Reading
 * the provider per validation call instead of a boot-time snapshot is what
 * keeps validation and the served pickers in lockstep: a model that appears
 * in every picker after a refresh must also validate (DD-004).
 *
 * Harness names, suggestion machinery, and the write-time pin-existence
 * rule all live in the registry module (the shared validation authority) —
 * this module consumes them so workflow errors and schedule/channel pin
 * errors suggest identically. The message strings are pinned identical to
 * the cloud Java ModelValidationHelper — keep them in lockstep.
 */
import type { RunConfig } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/invocation_pb";
import { ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { WorkflowSpec } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import type { AgentCallTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/agent_call_pb";
import type { EvalTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/eval_pb";
import type { LlmCallTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/llm_call_pb";

import { tryUnmarshalTaskConfig } from "../converter/unmarshal.js";
import {
  FAST_VARIANT_KEY,
  THINKING_CAPABILITY_KEY,
} from "../registry/model-registry-store.js";
import type { ModelCatalogProvider } from "../registry/model-catalog-provider.js";
import {
  HARNESS_NAME_NATIVE,
  harnessName,
  suggestSimilarModels,
} from "../registry/pin-validation.js";

/**
 * Checks that model IDs specified in workflow tasks are valid entries in
 * the model registry for the task's effective harness (Go
 * ValidateModelReferences):
 *   - agent_call: run_config.model_name (optional) against harness from
 *     the task config, plus the tier/thinking variant-attribute rules
 *   - llm_call: model (required) against the native harness
 *   - eval: model (required) against the native harness
 */
export function validateModelReferences(
  models: ModelCatalogProvider,
  spec: WorkflowSpec | undefined,
): string[] {
  if (spec === undefined || spec.tasks.length === 0) {
    return [];
  }
  if (!models.hasAnyModels()) {
    return [];
  }

  const errors: string[] = [];

  for (const task of spec.tasks) {
    if (task.taskConfig === undefined) {
      continue;
    }

    let model: string;
    let harness: string;
    let kindLabel: string;

    switch (task.kind) {
      case WorkflowTaskKind.agent_call: {
        kindLabel = "agent_call";
        const cfg = tryUnmarshalTaskConfig<AgentCallTaskConfig>(task.kind, task.taskConfig);
        if (cfg === undefined) {
          continue;
        }
        harness = harnessName(cfg.harness);
        // Variant-attribute validation is independent of the model check
        // below: FAST/ENABLED with no model_name must fail even though
        // the model loop skips (#357/#772, same fail-closed rule as
        // execution create).
        const tierErr = validateAgentCallServiceTier(models, task.name, harness, cfg.runConfig);
        if (tierErr !== "") {
          errors.push(tierErr);
        }
        const thinkingErr = validateAgentCallThinkingMode(models, task.name, harness, cfg.runConfig);
        if (thinkingErr !== "") {
          errors.push(thinkingErr);
        }
        if ((cfg.runConfig?.modelName ?? "") === "") {
          continue;
        }
        model = cfg.runConfig!.modelName;
        break;
      }

      case WorkflowTaskKind.llm_call: {
        kindLabel = "llm_call";
        const cfg = tryUnmarshalTaskConfig<LlmCallTaskConfig>(task.kind, task.taskConfig);
        if (cfg === undefined || cfg.model === "") {
          continue;
        }
        model = cfg.model;
        harness = HARNESS_NAME_NATIVE;
        break;
      }

      case WorkflowTaskKind.eval: {
        kindLabel = "eval";
        const cfg = tryUnmarshalTaskConfig<EvalTaskConfig>(task.kind, task.taskConfig);
        if (cfg === undefined || cfg.model === "") {
          continue;
        }
        model = cfg.model;
        harness = HARNESS_NAME_NATIVE;
        break;
      }

      default:
        continue;
    }

    if (!models.hasHarness(harness)) {
      continue;
    }
    if (models.isValidModel(harness, model)) {
      continue;
    }

    errors.push(buildModelError(models, task.name, kindLabel, model, harness));
  }

  return errors;
}

/**
 * Applies the same fail-closed service-tier rules as execution create to an
 * agent_call's run_config, with one extra dimension execution create cannot
 * have: the task config names its harness, so the fast variant must be
 * priced FOR THAT HARNESS — a fast price under another harness would
 * validate a tier the execution path can never apply (a silent no-op, the
 * exact class #357 exists to kill).
 *
 * STANDARD/unset is always valid; unknown tier strings never reach this
 * function (strict unmarshaling refuses non-canonical enum values).
 */
function validateAgentCallServiceTier(
  models: ModelCatalogProvider,
  taskName: string,
  harness: string,
  rc: RunConfig | undefined,
): string {
  if (rc?.serviceTier !== ServiceTier.FAST) {
    return "";
  }
  const modelName = (rc.modelName ?? "").trim();
  if (modelName === "") {
    return (
      `task '${taskName}' (agent_call): run_config.service_tier 'fast' requires ` +
      `run_config.model_name — the fast tier is a per-model price`
    );
  }
  if (!models.hasPricingVariantForHarness(harness, modelName, FAST_VARIANT_KEY)) {
    return (
      `task '${taskName}' (agent_call): run_config.service_tier 'fast' is not available ` +
      `for model '${modelName}' on harness '${harness}': the model registry prices no fast ` +
      `variant for it${fastCapableSuffix(models, harness)}`
    );
  }
  return "";
}

/**
 * Applies the same fail-closed thinking-mode rules as execution create to
 * an agent_call's run_config (oss#772), harness-scoped like the tier check
 * above. Capability-gated, not pricing-gated: thinking bills at base
 * per-token rates, so the registry fact that makes ENABLED selectable is
 * capabilities.thinking under the task's harness — which in v1 only the
 * cursor harness can honor.
 *
 * DISABLED/unset is always valid; unknown mode strings never reach this
 * function (strict unmarshaling refuses non-canonical enum values).
 */
function validateAgentCallThinkingMode(
  models: ModelCatalogProvider,
  taskName: string,
  harness: string,
  rc: RunConfig | undefined,
): string {
  if (rc?.thinkingMode !== ThinkingMode.ENABLED) {
    return "";
  }
  const modelName = (rc.modelName ?? "").trim();
  if (modelName === "") {
    return (
      `task '${taskName}' (agent_call): run_config.thinking_mode 'enabled' requires ` +
      `run_config.model_name — thinking is a per-model capability`
    );
  }
  if (!models.hasCapabilityForHarness(harness, modelName, THINKING_CAPABILITY_KEY)) {
    return (
      `task '${taskName}' (agent_call): run_config.thinking_mode 'enabled' is not available ` +
      `for model '${modelName}' on harness '${harness}': the model registry declares no thinking ` +
      `capability for it${thinkingCapableSuffix(models, harness)}`
    );
  }
  return "";
}

/**
 * Renders "; models with a thinking mode on '<harness>': a, b, c" —
 * actionable refusal detail, sorted (the store keeps the list sorted),
 * empty when the registry declares none for that harness.
 */
function thinkingCapableSuffix(
  models: ModelCatalogProvider,
  harness: string,
): string {
  const capable = models.canonicalModelsWithCapabilityForHarness(
    harness,
    THINKING_CAPABILITY_KEY,
  );
  if (capable.length === 0) {
    return "";
  }
  return `; models with a thinking mode on '${harness}': ${capable.join(", ")}`;
}

/**
 * Renders "; models with a fast tier on '<harness>': a, b, c" — sorted,
 * empty when the registry prices none for that harness.
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

function buildModelError(
  models: ModelCatalogProvider,
  taskName: string,
  kindLabel: string,
  model: string,
  harness: string,
): string {
  const suggestions = suggestSimilarModels(model, models.canonicalModels(harness));

  let msg = `task '${taskName}' (${kindLabel}): model '${model}' is not a valid model for harness '${harness}'`;

  if (suggestions.length > 0) {
    const quoted = suggestions.map((s) => `'${s}'`);
    msg += `. Did you mean: ${quoted.join(", ")}?`;
  }

  return msg;
}
