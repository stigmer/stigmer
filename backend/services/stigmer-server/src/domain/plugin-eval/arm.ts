/**
 * What a plugin eval's try attaches, per arm: the one place that decides
 * what "with the plugin" and "without the plugin" mean.
 *
 *   - with: the built-in assistant with the plugin under test listed in the
 *     session's `plugins`, at the archive the eval stamped (the reference's
 *     version is its digest), so the try runs the plugin whole: its skills,
 *     its agents, its hooks and its MCP servers;
 *   - without: the built-in assistant with nothing attached.
 *
 * Both arms run the same assistant, so the difference between them is the
 * plugin and nothing else: no prompt of an agent rides along, and
 * `status.provisional_delta` is false (PROVISIONAL_DELTA).
 *
 * An agent eval's try (agentAttachment) runs the agent instead, pinned to
 * the version the eval stamped through the session's `agent_ref`, with
 * every plugin the agent attaches listed at the archive the eval stamped.
 * A conversation's own plugin reference wins over its agent's at run
 * planning (domain/run/run-plugins.ts) and in the runner, and an open
 * conversation keeps its agent's version, so a plugin pushed or the agent
 * saved during the eval moves none of its tries. It has one arm: with. A
 * subagent's own plugin references are its own: one that names no version
 * resolves to the version installed when its turn starts, as in any
 * conversation of the agent.
 *
 * Proven by __tests__/arm.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { toolServerSegment } from "@stigmer/plugin-package";

/** Whether the arms' comparison also measures something beside the plugin (the module header). */
export const PROVISIONAL_DELTA = false;

/** A try's arm. */
export type EvalArm = "with" | "without";

/** What the arms need to know of the installed plugin. */
export interface PluginAttachmentFacts {
  /** The plugin's organization. */
  readonly org: string;
  /**
   * The plugin's id, which the with-plugin arm's reference holds; absent
   * from a context written before references held ids, whose arm names
   * the slug.
   */
  readonly id?: string;
  /** The plugin's slug. */
  readonly slug: string;
  /** The archive the eval stamped, which the reference pins. */
  readonly digest: string;
  /**
   * Each of the plugin's MCP servers as a turn names it,
   * `plugin_<plugin>_<server>` (`toolServerSegment`), in entry order: the
   * names a try's lists turn the servers off by, and the ones its trace
   * reads.
   */
  readonly serverSegments: ReadonlyArray<string>;
}

/** What a try's session attaches. */
export interface ArmAttachment {
  /** The agent the session runs, pinned to a version; absent runs the built-in assistant. */
  readonly agentRef?: ApiResourceReference;
  /** The plugins the session lists; empty runs the assistant alone. */
  readonly plugins: ReadonlyArray<ApiResourceReference>;
}

export function armAttachment(
  arm: EvalArm,
  plugin: Pick<PluginAttachmentFacts, "org" | "id" | "slug" | "digest">,
): ArmAttachment {
  switch (arm) {
    case "without":
      return { plugins: [] };
    case "with":
      return {
        plugins: [
          create(ApiResourceReferenceSchema, {
            org: plugin.org,
            kind: ApiResourceKind.plugin,
            ...heldBy(plugin),
            version: plugin.digest,
          }),
        ],
      };
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhausted: never = arm;
      return exhausted;
    }
  }
}

/** The plugin's facts, from the row the eval loaded at the digest it stamped. */
export function pluginAttachmentFacts(plugin: Plugin, digest: string): PluginAttachmentFacts {
  const name = plugin.metadata?.name ?? "";
  return {
    org: plugin.metadata?.org ?? "",
    id: plugin.metadata?.id ?? "",
    slug: plugin.metadata?.slug ?? "",
    digest,
    serverSegments: (plugin.status?.mcpServers ?? []).map((server) => toolServerSegment(name, server.name)),
  };
}

/** The agent an agent eval's tries run: its organization, id, slug and the version the eval stamped. */
export interface AgentAttachmentFacts {
  readonly org: string;
  /** The id the session's agent reference holds; absent from a context written before references held ids. */
  readonly id?: string;
  readonly slug: string;
  /** The agent version's hash, which the session's agent reference pins. */
  readonly versionHash: string;
}

/** An agent eval's try: the agent at its stamped version, every attached plugin at its stamped archive (the module header). */
export function agentAttachment(
  agent: AgentAttachmentFacts,
  plugins: ReadonlyArray<Pick<PluginAttachmentFacts, "org" | "id" | "slug" | "digest">>,
): ArmAttachment {
  return {
    agentRef: create(ApiResourceReferenceSchema, {
      org: agent.org,
      kind: ApiResourceKind.agent,
      ...heldBy(agent),
      version: agent.versionHash,
    }),
    plugins: plugins.map((plugin) => armAttachment("with", plugin).plugins[0]!),
  };
}

/**
 * What a try's reference names its target by: the id, so a target deleted
 * and remade under its name between the eval's start and a try is never
 * the one the try runs; the slug for a context written without one.
 */
function heldBy(target: { readonly id?: string; readonly slug: string }): { id: string } | { slug: string } {
  return target.id !== undefined && target.id !== "" ? { id: target.id } : { slug: target.slug };
}
