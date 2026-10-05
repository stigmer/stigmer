/**
 * The plugin's purge (domain/organization/purge/kind-purge.ts): every
 * plugin of an organization being deleted, removed with its delete chain's
 * cleanup (controller.ts `deletePlugin`: its version archives, the row, its
 * access, its search entry) and without its refusal of a plugin whose
 * members something references.
 *
 * One step of the chain is left out on purpose: CascadeDeleteMembers. It
 * deletes each member through the plugin materializer, which calls the
 * members' delete RPCs, and a purge never calls the RPC surface (every RPC
 * naming the organization answers not-found by then). A plugin's members
 * are the organization's agents, skills, MCP servers and workflows, which
 * their own purges remove before this one runs (boot/organization-purge.ts
 * orders them first).
 */
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginCommandController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { newDeleteSearchIndexStep } from "../../pipeline/steps/index-search.js";
import { newDeleteVersionArchivesStep } from "../../pipeline/steps/version-archive.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";

type DeleteInput = typeof PluginCommandController.method.delete.input;

export interface PluginPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

export function newPluginPurge(deps: PluginPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.plugin,
    schema: PluginSchema,
    input: PluginCommandController.method.delete.input,
    steps: [
      newDeleteVersionArchivesStep<DeleteInput>(deps.store, deps.logger, {
        stepName: "DeletePluginArchives",
        noun: "plugin",
      }),
      newDeleteResourceStep(deps.store),
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
      newDeleteSearchIndexStep(deps.store, deps.logger),
    ],
  });
}
