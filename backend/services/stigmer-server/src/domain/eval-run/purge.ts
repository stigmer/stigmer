/**
 * The eval run's purge (domain/organization/purge/kind-purge.ts): every
 * eval of an organization being deleted, removed with its delete chain's
 * cleanup: its workflow asked to stop, the row and its access, read
 * through the eval list index. It runs after the conversations' purge,
 * which has already removed every try, and before the plugins' purge, so
 * each eval's access is cleaned while its plugin still links it to the
 * organization. A try cannot start meanwhile: its create names the
 * organization, which the deleting-organization interceptor refuses.
 */
import { EvalRunSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import type { EvalRun } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunCommandController } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/command_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { newCleanupGrantsStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { newReleaseNamesStep } from "../../pipeline/steps/names.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";
import { evalRunListIndex } from "./list-index.js";
import { askEvalRunToStop } from "./cascade.js";
import type { EvalRunWorkflows } from "./workflows.js";

export interface EvalRunPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The eval workflows' port; absent, the purge stops none (each finds no row to write to). */
  readonly evalRunWorkflows?: EvalRunWorkflows;
}

type DeleteDesc = typeof EvalRunCommandController.method.delete.input;

export function newEvalRunPurge(deps: EvalRunPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.eval_run,
    schema: EvalRunSchema,
    input: EvalRunCommandController.method.delete.input,
    listIndex: evalRunListIndex,
    steps: [
      newStopEvalRunStep(deps),
      newDeleteResourceStep(deps.store),
      newReleaseNamesStep(deps.store, deps.logger, ApiResourceKind.eval_run),
      newCleanupGrantsStep(deps.authorizationLifecycle, deps.logger),
    ],
  });
}

/**
 * StopEvalRun: a pending or running eval's workflow is asked to cancel,
 * best effort: the eval's row goes either way, and a workflow that outlives
 * it finds no row to write to and no organization to start a try in.
 */
function newStopEvalRunStep(deps: EvalRunPurgeDeps): PipelineStep<DeleteDesc> {
  return {
    name: "StopEvalRun",
    async execute(ctx: RequestContext<DeleteDesc>): Promise<void> {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as EvalRun | undefined;
      if (existing !== undefined) {
        await askEvalRunToStop(
          deps.evalRunWorkflows,
          deps.logger,
          existing,
          "a purged eval run's workflow could not be cancelled",
        );
      }
    },
  };
}
