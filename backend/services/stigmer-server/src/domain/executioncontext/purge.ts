/**
 * The execution context's purge (domain/organization/purge/kind-purge.ts):
 * every execution context filed under an organization being deleted,
 * removed with its delete chain's cleanup (controller.ts
 * `deleteExecutionContext`: the row, its access, its search entry). The
 * kind is owner-only, not organization-scoped, but each row is its run's
 * and holds that organization's resolved vault values, so it goes
 * with the organization (`metadata.org`, as the credential binding reads
 * it).
 */
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { ExecutionContextCommandController } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/command_pb";
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

export interface ExecutionContextPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

export function newExecutionContextPurge(deps: ExecutionContextPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.execution_context,
    schema: ExecutionContextSchema,
    input: ExecutionContextCommandController.method.delete.input,
    steps: [
      newDeleteResourceStep(deps.store),
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
      newDeleteSearchIndexStep(deps.store, deps.logger),
    ],
  });
}
