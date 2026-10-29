/**
 * The agent execution's purge (domain/organization/purge/kind-purge.ts):
 * every execution of an organization being deleted, removed with its
 * delete chain's cleanup (controller.ts `deleteExecution`: the row, its
 * access, its search entry), read through the execution list index.
 * Core quiesce has already terminated the run.
 *
 * A run holds no bytes of its own. The files sent with its messages are
 * Files, purged by the File's own purge (domain/file/purge.ts).
 */
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunCommandController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/command_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupGrantsStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { newDeleteSearchIndexStep } from "../../pipeline/steps/index-search.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";
import { agentExecutionListIndex } from "./list-index.js";

export interface AgentExecutionPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

export function newAgentExecutionPurge(
  deps: AgentExecutionPurgeDeps,
): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.run,
    schema: RunSchema,
    input: RunCommandController.method.delete.input,
    listIndex: agentExecutionListIndex,
    steps: [
      newDeleteResourceStep(deps.store),
      newCleanupGrantsStep(deps.authorizationLifecycle, deps.logger),
      newDeleteSearchIndexStep(deps.store, deps.logger),
    ],
  });
}
