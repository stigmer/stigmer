/**
 * The platform client's purge (domain/organization/purge/kind-purge.ts):
 * every client of an organization being deleted, removed with its delete
 * chain's cleanup (controller.ts `deleteClient`: the row through the
 * client port, its access) and without its refusal of a system-managed
 * client: the organization that manages it goes too.
 *
 * Rows are read and deleted through the PlatformClientStore port the
 * composition bound, never the generic store: a composition may keep its
 * clients in a table of its own (compose.ts `platformClients`).
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { PlatformClientCommandController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/command_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";
import { newDeleteClientStep } from "./steps.js";
import type { PlatformClientStore } from "./store.js";

type DeleteInput = typeof PlatformClientCommandController.method.delete.input;

export interface PlatformClientPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The client port the composition bound. */
  readonly platformClients: PlatformClientStore;
}

export function newPlatformClientPurge(
  deps: PlatformClientPurgeDeps,
): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.platform_client,
    schema: PlatformClientSchema,
    input: PlatformClientCommandController.method.delete.input,
    rows: async (org, limit) =>
      (await deps.platformClients.findByOrg(org.id)).slice(0, limit),
    steps: [
      newDeleteClientStep<DeleteInput>(deps.platformClients),
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
    ],
  });
}
