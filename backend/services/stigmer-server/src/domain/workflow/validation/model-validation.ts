/**
 * Harness-aware model-reference validation — ports
 * pkg/domain/workflow/validation/model_validation.go.
 *
 * Model validity comes from the composed ModelCatalogProvider —
 * the same document the /v1/proxy/model-registry HTTP lane serves. Reading
 * the provider per validation call instead of a boot-time snapshot is what
 * keeps validation and the served pickers in lockstep: a model that appears
 * in every picker after a refresh must also validate.
 *
 * Harness names, suggestion machinery, and the write-time pin-existence
 * rule all live in the model catalog (src/modelcatalog, the shared
 * validation authority) —
 * this module consumes them so workflow errors and schedule/channel pin
 * errors suggest identically. The message strings are pinned identical to
 * the cloud Java ModelValidationHelper — keep them in lockstep.
 */
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { WorkflowSpec } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import type { AgentCallTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/agent_call_pb";
import type { EvalTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/eval_pb";
import type { LlmCallTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/llm_call_pb";

import { tryUnmarshalTaskConfig } from "../converter/unmarshal.js";
import type { ModelCatalogProvider } from "../../../modelcatalog/model-catalog-provider.js";
import {
  HARNESS_NAME_NATIVE,
  harnessName,
  suggestSimilarModels,
} from "../../../modelcatalog/pin-validation.js";
import {
  savedServiceTierRefusal,
  savedThinkingModeRefusal,
} from "../../../modelcatalog/run-config-checks.js";

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
        // the model loop skips (#357/#772; saved settings name their own
        // model, modelcatalog/run-config-checks.ts).
        const site = {
          prefix: `task '${task.name}' (agent_call): `,
          fieldPath: "run_config",
        };
        const tierErr = savedServiceTierRefusal(models, site, harness, cfg.runConfig);
        if (tierErr !== "") {
          errors.push(tierErr);
        }
        const thinkingErr = savedThinkingModeRefusal(models, site, harness, cfg.runConfig);
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
