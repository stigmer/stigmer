/**
 * Which agent a plugin eval's try runs on, per arm: the one place that
 * decides what "with the plugin" and "without the plugin" mean.
 *
 *   - with: the agent the plugin's install composed (the plugin's agent
 *     member, found by the `stigmer.ai/plugin` membership label), which
 *     carries the plugin's skills, servers, sub-agents and hooks. A plugin
 *     that composes no agent (an MCP-only plugin) runs on the assistant
 *     with the plugin's MCP servers attached to the session
 *     (`SessionSpec.mcp_server_usages`).
 *   - without: the assistant, with nothing attached.
 *
 * The composed agent's instructions name the plugin, so today the
 * difference between the arms also measures that prompt, not only the
 * plugin's parts. The eval says so: its `status.provisional_delta` is
 * true (PROVISIONAL_DELTA). When sessions attach plugins directly, this
 * body becomes `SessionSpec.plugins` at the eval's stamped digest for the
 * with-arm, both arms run on the assistant, the composed-agent branch is
 * deleted, and the flag turns false.
 *
 * Proven by __tests__/arm.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import type { McpServerUsage } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/usage_pb";
import { McpServerUsageSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/usage_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import type { Store } from "../../store/interface.js";
import { findMembers } from "../plugin/members.js";

/** Whether the arms' comparison also measures the composed agent (the module header). */
export const PROVISIONAL_DELTA = true;

/** A try's arm. */
export type EvalArm = "with" | "without";

/** What the arms need to know of the installed plugin. */
export interface PluginAttachmentFacts {
  /** The plugin's organization: its members live there. */
  readonly org: string;
  /** The slug of the agent its install composed; undefined when it composed none. */
  readonly agentSlug?: string;
  /** The slugs of the MCP servers it installed, in member order. */
  readonly mcpServerSlugs: ReadonlyArray<string>;
}

/** What a try's session attaches. */
export interface ArmAttachment {
  /** The agent the session runs; undefined runs the assistant. */
  readonly agentRef?: ApiResourceReference;
  /** Servers the session itself attaches. */
  readonly mcpServerUsages: ReadonlyArray<McpServerUsage>;
}

export function armAttachment(
  arm: EvalArm,
  plugin: PluginAttachmentFacts,
): ArmAttachment {
  switch (arm) {
    case "without":
      return { mcpServerUsages: [] };
    case "with":
      if (plugin.agentSlug !== undefined) {
        return {
          agentRef: create(ApiResourceReferenceSchema, {
            org: plugin.org,
            kind: ApiResourceKind.agent,
            slug: plugin.agentSlug,
          }),
          mcpServerUsages: [],
        };
      }
      return {
        mcpServerUsages: plugin.mcpServerSlugs.map((slug) =>
          create(McpServerUsageSchema, {
            mcpServerRef: create(ApiResourceReferenceSchema, {
              org: plugin.org,
              kind: ApiResourceKind.mcp_server,
              slug,
            }),
          }),
        ),
      };
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhausted: never = arm;
      return exhausted;
    }
  }
}

/**
 * The plugin's facts, from its members in its organization. A plugin
 * composes at most one agent; should a store hold more (a row left by an
 * interrupted push), the first by slug runs, so every try of an eval runs
 * the same one.
 */
export async function pluginAttachmentFacts(
  store: Store,
  pluginId: string,
  org: string,
): Promise<PluginAttachmentFacts> {
  const members = await findMembers(store, pluginId, org);
  const agents = members
    .filter((member) => member.kind === ApiResourceKind.agent)
    .map((member) => member.slug)
    .sort();
  const servers = members
    .filter((member) => member.kind === ApiResourceKind.mcp_server)
    .map((member) => member.slug);
  const agentSlug = agents[0];
  return agentSlug === undefined
    ? { org, mcpServerSlugs: servers }
    : { org, agentSlug, mcpServerSlugs: servers };
}
