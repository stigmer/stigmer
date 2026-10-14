/**
 * GuardMcpServers — only an organization's admins point its runs at a new
 * address. An agent's own MCP server is dialed by every run of the agent,
 * with the run's login at that address and the run's values in its
 * headers, so adding one, or changing where one points or what it sends,
 * is the same act as installing a plugin that carries the server: it asks
 * the organization's `can_create_plugin` (its admins).
 *
 * The check is by content, as the reserved-labels guard's is: whole-resource
 * writes echo the stored servers back, so an echo passes, and a removal
 * passes because it only shrinks where runs reach. Only a server that is
 * new, or whose address or headers differ from the stored one of that name,
 * asks the authorizer, so a member editing the rest of an agent pays no
 * authorization round-trip. A request the server composed itself passes,
 * as it does for the labels guard: the service code that built it already
 * made the decision. The refusal is PermissionDenied ("ask an admin"), the
 * child-organizations precedent, since the request is well formed and only
 * the caller's role is wrong.
 *
 * Placement: right after GuardReservedLabels in create and update, where
 * `ctx.newState` is the state that will persist and update chains carry
 * the stored agent under EXISTING_RESOURCE_KEY.
 *
 * Proven by __tests__/guard-mcp-servers.test.ts and the
 * agent-mcp-servers conformance suite on the enforcing lane.
 */
import type { Agent, AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentMcpServer } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import { isServerComposedRequest } from "../../extensions/identity.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { authorizeResolvedResource } from "../../pipeline/steps/authorize.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";

/** The refusal a member hears, naming the servers the write would add or change. */
export function mcpServersAdminOnlyMessage(names: ReadonlyArray<string>): string {
  return (
    `only an organization's admins may add or change an agent's MCP servers (${names.join(", ")}); ` +
    "ask an admin, or use a plugin an admin installed"
  );
}

/** A server's headers as one comparable string: entries sorted by name. */
function headersKey(headers: Readonly<Record<string, string>>): string {
  return JSON.stringify(Object.entries(headers).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * The names of the servers `requested` introduces or changes relative to
 * `stored`: a server is changed when its URL or any header differs from
 * the stored server of the same name. Echoes and removals are not
 * mutations. Sorted, so the refusal reads the same whatever the order.
 */
export function mcpServerMutations(
  stored: ReadonlyArray<AgentMcpServer>,
  requested: ReadonlyArray<AgentMcpServer>,
): ReadonlyArray<string> {
  const before = new Map(stored.map((server) => [server.name, server]));
  const mutations: string[] = [];
  for (const server of requested) {
    const was = before.get(server.name);
    if (was === undefined || was.url !== server.url || headersKey(was.headers) !== headersKey(server.headers)) {
      mutations.push(server.name);
    }
  }
  return mutations.sort();
}

export function newGuardMcpServersStep(authorizer: Authorizer): PipelineStep<typeof AgentSchema> {
  return {
    name: "GuardMcpServers",
    async execute(ctx: RequestContext<typeof AgentSchema>): Promise<void> {
      if (isServerComposedRequest(ctx.callerIdentity)) {
        return;
      }
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Agent | undefined;
      const mutations = mcpServerMutations(
        existing?.spec?.mcpServers ?? [],
        ctx.newState.spec?.mcpServers ?? [],
      );
      if (mutations.length === 0) {
        return;
      }
      await authorizeResolvedResource(
        authorizer,
        ctx.callerIdentity,
        {
          permission: IamPermission.can_create_plugin,
          resourceKind: ApiResourceKind.organization,
          resourceId: ctx.newState.metadata?.org ?? "",
        },
        mcpServersAdminOnlyMessage(mutations),
      );
    },
  };
}
