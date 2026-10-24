/**
 * RefuseUnofferedEngine — a message's half of the offered-engine rule
 * (domain/session/harness.ts): a turn whose conversation would run on an
 * engine this platform does not offer is refused before anything is
 * stored, never run as another engine. It reads the engine ResolveRunConfig
 * placed the conversation on (`RunConfigPlacement.engine`): a stored
 * session's, the new conversation's own, or its agent's, so a session or
 * agent stored before the rule, or one whose engine came from a default,
 * is judged as it would run.
 *
 * Placement: right after ResolveRunConfig, before the pre-side-effect gate
 * slot, so a refusal orphans nothing and every edition's runs pass it.
 * CreateSessionIfNeeded judges a re-resolved placement again
 * (create-steps.ts).
 */
import type { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";

import { failedPreconditionError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { offeredHarnessRefusal } from "../session/harness.js";
import { runConfigPlacementOf } from "./resolve-run-config.js";

/** How the refusal names what it judged. */
export const RUN_ENGINE_FIELD = "the conversation's engine";

export function newRefuseUnofferedEngineStep(): PipelineStep<typeof RunSchema> {
  return {
    name: "RefuseUnofferedEngine",
    execute(ctx) {
      const placement = runConfigPlacementOf(ctx);
      if (placement === undefined) {
        return;
      }
      const refusal = offeredHarnessRefusal(placement.engine, RUN_ENGINE_FIELD);
      if (refusal !== "") {
        throw failedPreconditionError(refusal);
      }
    },
  };
}
