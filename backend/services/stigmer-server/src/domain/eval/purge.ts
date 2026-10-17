/**
 * The eval's purge (domain/organization/purge/kind-purge.ts): every eval
 * of an organization being deleted, removed with its delete chain's
 * cleanup (controller.ts `deleteEval`: its version history, the row, its
 * names and its access). Nothing refuses an eval's delete, so the purge
 * leaves nothing out.
 */
import { EvalSchema } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/api_pb";
import { EvalCommandController } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/command_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupGrantsStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { newReleaseNamesStep } from "../../pipeline/steps/names.js";
import { newDeleteVersionArchivesStep } from "../../pipeline/steps/version-archive.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";
import { EVAL_NOUN } from "./constants.js";

type DeleteInput = typeof EvalCommandController.method.delete.input;

export interface EvalPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

export function newEvalPurge(deps: EvalPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.eval,
    schema: EvalSchema,
    input: EvalCommandController.method.delete.input,
    steps: [
      newDeleteVersionArchivesStep<DeleteInput>(deps.store, deps.logger, {
        stepName: "DeleteEvalArchives",
        noun: EVAL_NOUN,
      }),
      newDeleteResourceStep(deps.store),
      newReleaseNamesStep(deps.store, deps.logger, ApiResourceKind.eval),
      newCleanupGrantsStep(deps.authorizationLifecycle, deps.logger),
    ],
  });
}
