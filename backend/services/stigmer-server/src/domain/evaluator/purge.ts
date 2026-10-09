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
import { EvaluatorSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { EvaluatorCommandController } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";
import { evaluatorListIndex } from "./list-index.js";

export interface EvaluatorPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

export function newEvaluatorPurge(deps: EvaluatorPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.evaluator,
    schema: EvaluatorSchema,
    input: EvaluatorCommandController.method.delete.input,
    listIndex: evaluatorListIndex,
    steps: [
      newDeleteResourceStep(deps.store),
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
    ],
  });
}
