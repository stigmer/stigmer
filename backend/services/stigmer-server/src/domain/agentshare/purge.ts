/**
 * The agent share's purge (domain/organization/purge/kind-purge.ts):
 * every share of an organization being deleted, removed with its delete
 * chain's cleanup (controller.ts `deleteShare`): the row and its access.
 * An agent's own purge cascades its shares first; this one removes any a
 * share's organization holds that its agent's purge did not reach.
 */
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { AgentShareCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";

export interface AgentSharePurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

export function newAgentSharePurge(deps: AgentSharePurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.agent_share,
    schema: AgentShareSchema,
    input: AgentShareCommandController.method.delete.input,
    steps: [
      newDeleteResourceStep(deps.store),
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
    ],
  });
}
