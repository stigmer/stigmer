/**
 * The MCP server's purge (domain/organization/purge/kind-purge.ts): every
 * MCP server of an organization being deleted, removed with its delete
 * chain's cleanup (controller.ts `deleteMcpServer`: the row, its access,
 * its search entry) and without its refusal of a plugin-managed server:
 * the plugin goes too. Its pending sign-ins went in core quiesce, by
 * organization; the sign-ins saved for it live in vaults and go with the
 * organization's vaults (domain/vault/purge.ts).
 */
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
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

export interface McpServerPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

export function newMcpServerPurge(deps: McpServerPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.mcp_server,
    schema: McpServerSchema,
    input: McpServerCommandController.method.delete.input,
    steps: [
      newDeleteResourceStep(deps.store),
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
      newDeleteSearchIndexStep(deps.store, deps.logger),
    ],
  });
}
