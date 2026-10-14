/**
 * The agent eval's purge (domain/organization/purge/kind-purge.ts): every
 * eval of an organization being deleted, removed with its delete chain's
 * cleanup: its workflow asked to stop, the row and its access, read
 * through the eval list index. It runs after the conversations' purge,
 * which has already removed every try, and before the agents' purge, so
 * each eval's access is cleaned while its agent still links it to the
 * organization, as the plugin eval's purge does (domain/plugin-eval/purge.ts).
 */
import { AgentEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import type { AgentEval } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { AgentEvalCommandController } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { newCleanupGrantsStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type { KindPurge, KindPurgeDeps } from "../organization/purge/kind-purge.js";
import { askPluginEvalToStop } from "../plugin-eval/cascade.js";
import type { PluginEvalWorkflows } from "../plugin-eval/workflows.js";
import { agentEvalListIndex } from "./list-index.js";
import { newReleaseNamesStep } from "../../pipeline/steps/names.js";

export interface AgentEvalPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The agent eval workflows' port; absent, the purge stops none (each finds no row to write to). */
  readonly agentEvalWorkflows?: PluginEvalWorkflows;
}

type DeleteDesc = typeof AgentEvalCommandController.method.delete.input;

export function newAgentEvalPurge(deps: AgentEvalPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.agent_eval,
    schema: AgentEvalSchema,
    input: AgentEvalCommandController.method.delete.input,
    listIndex: agentEvalListIndex,
    steps: [
      newStopAgentEvalStep(deps),
      newDeleteResourceStep(deps.store),
      newReleaseNamesStep(deps.store, deps.logger, ApiResourceKind.agent_eval),
      newCleanupGrantsStep(deps.authorizationLifecycle, deps.logger),
    ],
  });
}

/** StopAgentEval: a pending or running eval's workflow is asked to cancel, best effort. */
function newStopAgentEvalStep(deps: AgentEvalPurgeDeps): PipelineStep<DeleteDesc> {
  return {
    name: "StopAgentEval",
    async execute(ctx: RequestContext<DeleteDesc>): Promise<void> {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as AgentEval | undefined;
      if (existing !== undefined) {
        await askPluginEvalToStop(
          deps.agentEvalWorkflows,
          deps.logger,
          existing,
          "a purged agent eval's workflow could not be cancelled",
        );
      }
    },
  };
}
