/**
 * The memory's purge (domain/organization/purge/kind-purge.ts): every
 * memory of an organization being deleted, removed with its delete chain's
 * cleanup (controller.ts `deleteMemory`): the row and its access, read
 * through the memory list index.
 */
import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { MemoryCommandController } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { memoryListIndex } from "./list-index.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";

export interface MemoryPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

export function newMemoryPurge(deps: MemoryPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.memory,
    schema: MemorySchema,
    input: MemoryCommandController.method.delete.input,
    listIndex: memoryListIndex,
    steps: [
      newDeleteResourceStep(deps.store),
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
    ],
  });
}
