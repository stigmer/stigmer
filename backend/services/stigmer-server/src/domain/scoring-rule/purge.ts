/**
 * The evaluator's purge (domain/organization/purge/kind-purge.ts): every
 * evaluator of an organization being deleted, removed with its delete
 * chain's cleanup (controller.ts `deleteEvaluator`): the row and its
 * access, read through the evaluator list index. It runs before the
 * agents' purge, so each evaluator's access is cleaned while its agent
 * still links it to the organization. A judge run cannot start meanwhile:
 * its create names the organization, which the deleting-organization
 * interceptor refuses.
 */
import { ScoringRuleSchema } from "@stigmer/protos/ai/stigmer/agentic/scoringrule/v1/api_pb";
import { ScoringRuleCommandController } from "@stigmer/protos/ai/stigmer/agentic/scoringrule/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupGrantsStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { newReleaseNamesStep } from "../../pipeline/steps/names.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";
import { scoringRuleListIndex } from "./list-index.js";

export interface ScoringRulePurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

export function newScoringRulePurge(deps: ScoringRulePurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.scoring_rule,
    schema: ScoringRuleSchema,
    input: ScoringRuleCommandController.method.delete.input,
    listIndex: scoringRuleListIndex,
    steps: [
      newDeleteResourceStep(deps.store),
      newReleaseNamesStep(deps.store, deps.logger, ApiResourceKind.scoring_rule),
      newCleanupGrantsStep(deps.authorizationLifecycle, deps.logger),
    ],
  });
}
