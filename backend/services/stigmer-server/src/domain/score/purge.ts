/**
 * The score's purge (domain/organization/purge/kind-purge.ts): every
 * score of an organization being deleted, removed with its delete chain's
 * cleanup (controller.ts `deleteScore`): the row and its access, read
 * through the score list index. It runs before the runs' purge, so each
 * score's access is cleaned while its run still links it to the
 * organization.
 */
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ScoreCommandController } from "@stigmer/protos/ai/stigmer/agentic/score/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";
import { scoreListIndex } from "./list-index.js";

export interface ScorePurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

export function newScorePurge(deps: ScorePurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.score,
    schema: ScoreSchema,
    input: ScoreCommandController.method.delete.input,
    listIndex: scoreListIndex,
    steps: [
      newDeleteResourceStep(deps.store),
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
    ],
  });
}
