/**
 * The workflow execution's purge (domain/organization/purge/kind-purge.ts):
 * every workflow execution of an organization being deleted, removed with
 * its delete chain's cleanup (controller.ts `deleteExecution`: the row, its
 * access, its search entry), read through the execution list index.
 *
 * One removal the chain does not make: the execution's event log
 * (`workflow_execution_events`, Store.deleteWorkflowExecutionEvents). No
 * delete path removes it today, so deleting an execution through its RPC
 * leaves the log behind; a purge must not. Core quiesce has already
 * terminated the run and torn its sandbox down.
 */
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import {
  RESOURCE_ID_KEY,
  newDeleteResourceStep,
} from "../../pipeline/steps/delete.js";
import { newDeleteSearchIndexStep } from "../../pipeline/steps/index-search.js";
import type { Store } from "../../store/interface.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";
import { workflowExecutionListIndex } from "./list-index.js";

type DeleteInput =
  typeof WorkflowExecutionCommandController.method.delete.input;

export interface WorkflowExecutionPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

export function newWorkflowExecutionPurge(
  deps: WorkflowExecutionPurgeDeps,
): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.workflow_execution,
    schema: WorkflowExecutionSchema,
    input: WorkflowExecutionCommandController.method.delete.input,
    listIndex: workflowExecutionListIndex,
    steps: [
      newDeleteResourceStep(deps.store),
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
      newDeleteSearchIndexStep(deps.store, deps.logger),
      newDeleteExecutionEventsStep(deps.store),
    ],
  });
}

/** DeleteExecutionEvents — the execution's event log, after its row. */
function newDeleteExecutionEventsStep(
  store: Pick<Store, "deleteWorkflowExecutionEvents">,
): PipelineStep<DeleteInput> {
  return {
    name: "DeleteExecutionEvents",
    async execute(ctx: RequestContext<DeleteInput>): Promise<void> {
      const id = ctx.get(RESOURCE_ID_KEY);
      if (typeof id === "string" && id !== "") {
        await store.deleteWorkflowExecutionEvents(id);
      }
    },
  };
}
