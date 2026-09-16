/**
 * The agent from a plugin — materialised only when the plugin carries
 * something agent-like: a skill, a sub-agent file, or an
 * `ai.stigmer/agent.yaml`. An MCP-only plugin becomes its servers and no
 * agent (the "a plugin is a toolbox, an agent is the worker" rule): most
 * plugins in the wild are one server and one token, and five thin agents
 * nobody runs would be the plugin-versus-agent confusion this kind exists
 * to remove.
 *
 * Two sources, never mixed: the author's `agent.yaml` wholesale when
 * present (its references still resolve in the agent chain's
 * ValidateReferences), otherwise the composed default — instructions from
 * the versioned template, every skill as a `skill_ref`, every server as an
 * `mcp_server_usage`, every `agents/*.md` as a `sub_agent` with access to
 * all the plugin's servers and the skills it asked for.
 *
 * Model hints are recorded, never applied: a dialect's `model` becomes a
 * status warning and the sub-agent runs on the session's model. The
 * catalog seam exposes neither family nor cost tier, the runner drops a
 * sub-agent whose override it cannot resolve, and pinning a model the user
 * did not choose has cost consequences; a later catalog seam can change
 * this in one place. A sub-agent named like a runner built-in is recorded
 * the same way: the runner warns and continues, so the install does too.
 */
import { create } from "@bufbuild/protobuf";

import type { PluginPackage, PluginSubAgent } from "@stigmer/plugin-package";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import {
  AgentSpecSchema,
  McpAccessSchema,
  McpServerUsageSchema,
  SubAgentSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { SubAgent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { PluginWarningSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import type { PluginWarning } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import {
  BUILT_IN_SUB_AGENT_NAMES,
  SERVER_WARNING_KINDS,
} from "../constants.js";
import { renderDefaultAgentInstructions } from "./default-agent-instructions.js";
import { memberMetadata } from "./identity.js";
import type { PluginIdentity } from "./identity.js";
import { mcpServerSlugOf } from "./mcp-servers.js";
import { skillSlugOf } from "./skills.js";

export interface PlannedAgent {
  readonly name: string;
  readonly slug: string;
  readonly resource: Agent;
}

/** Whether the plugin materialises an agent at all. */
export function carriesAgent(plugin: PluginPackage): boolean {
  return (
    plugin.skills.length > 0 ||
    plugin.subAgents.length > 0 ||
    plugin.overlay.agent !== undefined
  );
}

export function planAgent(
  plugin: PluginPackage,
  overlayAgent: Agent | undefined,
  identity: PluginIdentity,
  warnings: PluginWarning[],
): PlannedAgent | undefined {
  if (!carriesAgent(plugin)) {
    return undefined;
  }
  const member = { name: identity.name, slug: identity.slug };

  if (overlayAgent !== undefined) {
    return {
      ...member,
      resource: create(AgentSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Agent",
        metadata: memberMetadata(identity, member, overlayAgent.metadata),
        spec: overlayAgent.spec,
      }),
    };
  }

  const serverSlugs = plugin.mcpServers.map(mcpServerSlugOf);
  const skillSlugByName = new Map(
    plugin.skills.map((skill) => [skill.name, skillSlugOf(skill)]),
  );

  const spec = create(AgentSpecSchema, {
    description: plugin.description ?? "",
    instructions: renderDefaultAgentInstructions(plugin),
    skillRefs: [...skillSlugByName.values()].map((slug) =>
      create(ApiResourceReferenceSchema, {
        org: identity.org,
        kind: ApiResourceKind.skill,
        slug,
      }),
    ),
    mcpServerUsages: serverSlugs.map((slug) =>
      create(McpServerUsageSchema, {
        mcpServerRef: create(ApiResourceReferenceSchema, {
          org: identity.org,
          kind: ApiResourceKind.mcp_server,
          slug,
        }),
      }),
    ),
    subAgents: plugin.subAgents.map((subAgent) =>
      planSubAgent(subAgent, identity, serverSlugs, skillSlugByName, warnings),
    ),
  });

  return {
    ...member,
    resource: create(AgentSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: memberMetadata(identity, member),
      spec,
    }),
  };
}

function planSubAgent(
  subAgent: PluginSubAgent,
  identity: PluginIdentity,
  serverSlugs: readonly string[],
  skillSlugByName: ReadonlyMap<string, string>,
  warnings: PluginWarning[],
): SubAgent {
  if (BUILT_IN_SUB_AGENT_NAMES.has(subAgent.name)) {
    warnings.push(
      create(PluginWarningSchema, {
        kind: SERVER_WARNING_KINDS.subAgentNameBuiltin,
        path: subAgent.path,
        message:
          `sub-agent '${subAgent.name}' shares its name with a built-in sub-agent; ` +
          "the runner warns and runs the plugin's",
      }),
    );
  }
  const hint = subAgent.modelHint;
  if (
    hint !== undefined &&
    hint.alias !== "inherit" &&
    hint.alias !== "unknown"
  ) {
    // An unknown alias already carries the library's own sentence.
    warnings.push(
      create(PluginWarningSchema, {
        kind: SERVER_WARNING_KINDS.modelHintUnresolved,
        path: subAgent.path,
        message:
          `sub-agent '${subAgent.name}' names model '${hint.raw}'; Stigmer does not pin a model ` +
          "from a plugin, so it runs on the session's model",
      }),
    );
  }
  return create(SubAgentSchema, {
    name: subAgent.name,
    description: subAgent.description ?? "",
    instructions: subAgent.instructions,
    mcpAccess: serverSlugs.map((slug) =>
      create(McpAccessSchema, { mcpServer: slug }),
    ),
    skillRefs: subAgent.skillNames.flatMap((name) => {
      const slug = skillSlugByName.get(name);
      // An unknown skill name already carries the library's own warning.
      return slug === undefined
        ? []
        : [
            create(ApiResourceReferenceSchema, {
              org: identity.org,
              kind: ApiResourceKind.skill,
              slug,
            }),
          ];
    }),
  });
}
