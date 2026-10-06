/**
 * ValidateAgentRunConfig — the save-time rule for an agent's run defaults
 * (AgentSpec.run_config, judged on AgentSpec.harness), on create and update
 * before the version is hashed, so no version holding defaults the platform
 * would refuse is ever recorded.
 *
 * A model name belongs to an engine: each engine lists its own models, and
 * only two names appear on both. So the defaults are judged on the engine
 * they name:
 *   - a model with no engine named is refused: the name could mean either
 *     catalog, and on the wrong one Cursor would quietly run Auto;
 *   - a model the engine does not list is refused with a did-you-mean (the
 *     write-time existence rule every surface shares, pin-validation.ts;
 *     existence is never re-judged at run time, oss#774);
 *   - service_tier FAST and thinking_mode ENABLED need a model the engine
 *     prices fast or marks able to think, and saved settings name their own
 *     model (modelcatalog/run-config-checks.ts, the checks every saved
 *     surface shares).
 * An engine with no model is valid: "new conversations on this agent start
 * on Cursor". Bounds are proto-validated (non-negative) and need no engine.
 *
 * A registry the build cannot read checks nothing (the existence rule's
 * no-op posture), except the engine a model needs, which is a fact of the
 * write alone.
 *
 * Proven by __tests__/validate-run-config.test.ts and the agent conformance
 * suite's run-defaults arms.
 */
import type { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import { invalidArgumentError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { ModelCatalogProvider } from "../../modelcatalog/model-catalog-provider.js";
import {
  harnessName,
  unknownModelPinRefusal,
} from "../../modelcatalog/pin-validation.js";
import {
  savedServiceTierRefusal,
  savedThinkingModeRefusal,
} from "../../modelcatalog/run-config-checks.js";

const SITE = { fieldPath: "spec.run_config" } as const;

export function newValidateAgentRunConfigStep(
  models: ModelCatalogProvider,
): PipelineStep<typeof AgentSchema> {
  return {
    name: "ValidateAgentRunConfig",
    execute(ctx) {
      const spec = ctx.newState.spec;
      const defaults = spec?.runConfig;
      if (defaults === undefined) {
        return;
      }
      const engine = spec?.harness ?? Harness.UNSPECIFIED;
      const model = defaults.modelName.trim();
      if (model !== "" && engine === Harness.UNSPECIFIED) {
        throw invalidArgumentError(
          "spec.run_config.model_name requires spec.harness: a model name belongs to an " +
            "engine (native or cursor), and each lists its own models. Name the engine " +
            "the model was chosen for.",
        );
      }
      const harness = harnessName(engine);
      const refusal = [
        unknownModelPinRefusal(models, "spec.run_config.model_name", harness, model),
        savedServiceTierRefusal(models, SITE, harness, defaults),
        savedThinkingModeRefusal(models, SITE, harness, defaults),
      ].find((text) => text !== "");
      if (refusal !== undefined) {
        throw invalidArgumentError(refusal);
      }
    },
  };
}
