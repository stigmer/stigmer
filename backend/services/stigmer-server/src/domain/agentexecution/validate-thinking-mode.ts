/**
 * ValidateThinkingMode — fail-closed validation of
 * ExecutionConfig.thinking_mode against the model registry
 * (stigmer/stigmer#772), the sibling of ValidateServiceTier for the second
 * variant dimension, judged on the harness the execution will run on
 * (stigmer/stigmer#1280).
 *
 * Unlike the fast tier, thinking is capability-gated, not pricing-gated:
 * thinking variants bill at base per-token rates (ledger-verified), so the
 * registry fact that makes ENABLED selectable is a thinking capability on
 * the model's entry for the execution's harness — `thinking` (a fixed
 * budget) or `adaptiveThinking` (depth adapts). Both harnesses translate
 * the mode: Cursor as its thinking variant, native as Anthropic's
 * `thinking` parameter in the form the entry declares. The harness scoping
 * is what keeps a selection honest: an id such as claude-sonnet-5 has an
 * entry on each harness, and only the entry the execution runs on says
 * what its model does.
 *
 *   - UNSPECIFIED: always valid — it resolves to DISABLED in the runner,
 *     and a model that requires thinking thinks under it.
 *   - DISABLED: valid, except on a model whose entry declares
 *     `thinkingRequired` — it always thinks and the provider refuses a
 *     request to turn thinking off.
 *   - ENABLED: requires model_name to be set (Auto has no variant
 *     dimensions) and that model's entry on the harness to declare a
 *     thinking capability.
 *
 * The harness is the one CreateSessionIfNeeded and dispatch will use: the
 * stored session's for a turn on an existing session, else the bootstrap
 * session_spec's, UNSPECIFIED read as native (harnessName; the Cloud
 * billing gate resolves the same way). Reading a stored session is why the
 * step runs after the run gate: the caller is authorized to add a turn to
 * that session before anything about it is read, so a refusal never tells
 * an unauthorized caller which harness a session uses. It is still a pure
 * step, before any side effect.
 */
import type { AgentExecution, AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { internalError, invalidArgumentError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { ResourceNotFoundError, type Store } from "../../store/interface.js";
import type { ModelCatalogProvider } from "../workflow/registry/model-catalog-provider.js";
import {
  ADAPTIVE_THINKING_CAPABILITY_KEY,
  THINKING_CAPABILITY_KEY,
  THINKING_REQUIRED_CAPABILITY_KEY,
} from "../workflow/registry/model-registry-store.js";
import { harnessName } from "../workflow/registry/pin-validation.js";

export function newValidateThinkingModeStep(
  registry: ModelCatalogProvider,
  store: Store,
): PipelineStep<typeof AgentExecutionSchema> {
  return {
    name: "ValidateThinkingMode",
    async execute(ctx) {
      const config = ctx.newState.spec?.executionConfig;
      const mode = config?.thinkingMode ?? ThinkingMode.UNSPECIFIED;
      const modelName = (config?.modelName ?? "").trim();
      // UNSPECIFIED is always valid, and so is DISABLED on Auto (no model
      // to require thinking). Unknown enum numbers were already refused by
      // proto field validation (defined_only).
      if (mode === ThinkingMode.UNSPECIFIED || (mode === ThinkingMode.DISABLED && modelName === "")) {
        return;
      }

      const harness = await executionHarness(ctx.newState, store);

      if (mode === ThinkingMode.DISABLED) {
        if (registry.hasCapabilityForHarness(harness, modelName, THINKING_REQUIRED_CAPABILITY_KEY)) {
          throw invalidArgumentError(
            `thinking_mode 'disabled' is not available for model '${modelName}': the model always ` +
              `thinks on the ${harness} harness and refuses a request to turn thinking off. ` +
              "Leave thinking_mode unset, or set it to 'enabled'.",
          );
        }
        return;
      }

      if (modelName === "") {
        throw invalidArgumentError(
          "thinking_mode 'enabled' requires execution_config.model_name: thinking is a " +
            "per-model capability, and Auto (no pinned model) has no variant dimensions. " +
            `Pin a model that supports it${thinkingCapableSuffix(registry, harness)}.`,
        );
      }

      if (!canThink(registry, harness, modelName)) {
        throw invalidArgumentError(
          `thinking_mode 'enabled' is not available for model '${modelName}': the model ` +
            `registry declares no thinking capability for it on the ${harness} ` +
            `harness${thinkingCapableSuffix(registry, harness)}.`,
        );
      }
    },
  };
}

/** The registry section name of the harness this execution will run on. */
async function executionHarness(execution: AgentExecution, store: Store): Promise<string> {
  const sessionId = execution.spec?.sessionId ?? "";
  if (sessionId === "") {
    return harnessName(execution.spec?.sessionSpec?.harness ?? Harness.UNSPECIFIED);
  }
  try {
    const session = await store.getResource(ApiResourceKind.session, sessionId, SessionSchema);
    return harnessName(session.spec?.harness ?? Harness.UNSPECIFIED);
  } catch (error) {
    // A dangling session id is the loading steps' refusal to make, with
    // its own NotFound; judge it on the default harness, as dispatch does.
    // Any other failure is a store fault, never a reading of the session.
    if (error instanceof ResourceNotFoundError) {
      return harnessName(Harness.UNSPECIFIED);
    }
    throw internalError(error, "failed to load session for thinking-mode validation");
  }
}

function canThink(registry: ModelCatalogProvider, harness: string, modelName: string): boolean {
  return (
    registry.hasCapabilityForHarness(harness, modelName, THINKING_CAPABILITY_KEY) ||
    registry.hasCapabilityForHarness(harness, modelName, ADAPTIVE_THINKING_CAPABILITY_KEY)
  );
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
