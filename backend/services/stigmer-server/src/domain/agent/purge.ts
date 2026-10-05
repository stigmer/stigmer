/**
 * The agent's purge (domain/organization/purge/kind-purge.ts): every agent
 * of an organization being deleted, removed with its delete chain's
 * cleanup (controller.ts `deleteAgent`) and without its refusal of a
 * plugin-managed agent: the plugin goes too.
 *
 * The chain's steps after its load, in its order: the agent's shares, its
 * version archives, the row, its access, its search entry.
 */
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { newDeleteSearchIndexStep } from "../../pipeline/steps/index-search.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";
import { newCascadeDeleteSharesStep } from "./steps.js";
import { newDeleteAgentVersionsStep } from "./versions.js";

export interface AgentPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

export function newAgentPurge(deps: AgentPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.agent,
    schema: AgentSchema,
    input: AgentCommandController.method.delete.input,
    steps: [
      newCascadeDeleteSharesStep(
        deps.store,
        deps.authorizationLifecycle,
        deps.logger,
      ),
      newDeleteAgentVersionsStep(deps.store, deps.logger),
      newDeleteResourceStep(deps.store),
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
      newDeleteSearchIndexStep(deps.store, deps.logger),
    ],
  });
}
