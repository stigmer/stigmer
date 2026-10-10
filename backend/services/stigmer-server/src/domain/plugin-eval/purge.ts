/**
 * The plugin eval's purge (domain/organization/purge/kind-purge.ts): every
 * eval of an organization being deleted, removed with its delete chain's
 * cleanup: its workflow asked to stop, the row and its access, read
 * through the eval list index. It runs after the conversations' purge,
 * which has already removed every try, and before the plugins' purge, so
 * each eval's access is cleaned while its plugin still links it to the
 * organization. A try cannot start meanwhile: its create names the
 * organization, which the deleting-organization interceptor refuses.
 */
import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalCommandController } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";
import { pluginEvalListIndex } from "./list-index.js";
import { askPluginEvalToStop } from "./cascade.js";
import type { PluginEvalWorkflows } from "./workflows.js";

export interface PluginEvalPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The eval workflows' port; absent, the purge stops none (each finds no row to write to). */
  readonly pluginEvalWorkflows?: PluginEvalWorkflows;
}

type DeleteDesc = typeof PluginEvalCommandController.method.delete.input;

export function newPluginEvalPurge(deps: PluginEvalPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.plugin_eval,
    schema: PluginEvalSchema,
    input: PluginEvalCommandController.method.delete.input,
    listIndex: pluginEvalListIndex,
    steps: [
      newStopPluginEvalStep(deps),
      newDeleteResourceStep(deps.store),
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
    ],
  });
}

/**
 * StopPluginEval: a pending or running eval's workflow is asked to cancel,
 * best effort: the eval's row goes either way, and a workflow that outlives
 * it finds no row to write to and no organization to start a try in.
 */
function newStopPluginEvalStep(deps: PluginEvalPurgeDeps): PipelineStep<DeleteDesc> {
  return {
    name: "StopPluginEval",
    async execute(ctx: RequestContext<DeleteDesc>): Promise<void> {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as PluginEval | undefined;
      if (existing !== undefined) {
        await askPluginEvalToStop(
          deps.pluginEvalWorkflows,
          deps.logger,
          existing,
          "a purged plugin eval's workflow could not be cancelled",
        );
      }
    },
  };
}
